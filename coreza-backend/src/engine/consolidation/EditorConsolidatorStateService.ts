import { createHash, randomUUID } from "crypto";
import { RedisKeys } from "../../infra/redisKeys";
import {
  runConsolidatorStep,
  type ConsolidatorParameters,
  type ConsolidatorPayload,
} from "./consolidatorShared";

export const EDITOR_CONSOLIDATOR_STATE_TTL_SECONDS = 60 * 60 * 24;
const LOCK_TTL_MILLISECONDS = 10_000;
const MAX_RECORDED_OPERATIONS = 20;

export type EditorSeriesAction = "start" | "continue";

export interface EditorSourceProvenance {
  sourceNodeId: string;
  sourceRunId?: string;
}

interface RecordedOperation {
  requestFingerprint: string;
  result: ConsolidatorPayload;
}

interface StoredEditorState {
  version: 1;
  identity: EditorConsolidatorIdentity;
  sourceProvenance: EditorSourceProvenance;
  state: unknown;
  operations: Record<string, RecordedOperation>;
  operationOrder: string[];
}

export interface EditorConsolidatorIdentity {
  userId: string;
  workflowId: string;
  workflowSessionId: string;
  nodeId: string;
  configFingerprint: string;
}

export interface EditorConsolidatorStateClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "PX",
    expiry: number,
    setMode: "NX",
  ): Promise<"OK" | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<unknown>;
}

export class EditorConsolidatorStateError extends Error {
  constructor(
    public readonly code:
      | "DUPLICATE_OPERATION_CONFLICT"
      | "EDITOR_CONTEXT_EXPIRED"
      | "EDITOR_CONTEXT_RESET_REQUIRED"
      | "EXECUTION_CONTEXT_UNAVAILABLE"
      | "INVALID_CONSOLIDATOR_STATE",
    message: string,
  ) {
    super(message);
    this.name = "EditorConsolidatorStateError";
  }
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameIdentity(
  left: EditorConsolidatorIdentity,
  right: EditorConsolidatorIdentity,
): boolean {
  return (
    left.userId === right.userId &&
    left.workflowId === right.workflowId &&
    left.workflowSessionId === right.workflowSessionId &&
    left.nodeId === right.nodeId &&
    left.configFingerprint === right.configFingerprint
  );
}

function sameProvenance(
  left: EditorSourceProvenance,
  right: EditorSourceProvenance,
): boolean {
  return (
    left.sourceNodeId === right.sourceNodeId &&
    left.sourceRunId === right.sourceRunId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredEditorState(value: unknown): value is StoredEditorState {
  if (!isRecord(value) || value.version !== 1) return false;
  if (!("state" in value)) return false;
  if (!isRecord(value.identity) || !isRecord(value.sourceProvenance))
    return false;
  if (!isRecord(value.operations) || !Array.isArray(value.operationOrder)) {
    return false;
  }
  const identityFields = [
    value.identity.userId,
    value.identity.workflowId,
    value.identity.workflowSessionId,
    value.identity.nodeId,
    value.identity.configFingerprint,
  ];
  if (!identityFields.every((field) => typeof field === "string")) return false;
  if (typeof value.sourceProvenance.sourceNodeId !== "string") return false;
  if (
    value.sourceProvenance.sourceRunId !== undefined &&
    typeof value.sourceProvenance.sourceRunId !== "string"
  ) {
    return false;
  }
  if (!value.operationOrder.every((id) => typeof id === "string")) return false;
  return Object.values(value.operations).every(
    (operation) =>
      isRecord(operation) &&
      typeof operation.requestFingerprint === "string" &&
      isRecord(operation.result) &&
      typeof operation.result.emitted === "boolean" &&
      Object.prototype.hasOwnProperty.call(operation.result, "bar") &&
      isRecord(operation.result.workingBar),
  );
}

export class EditorConsolidatorStateService {
  constructor(private readonly redis: EditorConsolidatorStateClient) {}

  async execute(args: {
    identity: EditorConsolidatorIdentity;
    operationId: string;
    seriesAction: EditorSeriesAction;
    sourceProvenance: EditorSourceProvenance;
    parameters: ConsolidatorParameters;
    candleData: unknown;
  }): Promise<ConsolidatorPayload> {
    const {
      identity,
      operationId,
      seriesAction,
      sourceProvenance,
      parameters,
      candleData,
    } = args;

    // Validate the complete input before allocating a Redis lock or state key.
    runConsolidatorStep(parameters, candleData);
    const key = this.buildKey(identity);
    const requestFingerprint = stableFingerprint({
      parameters,
      candleData,
      sourceProvenance,
    });

    return this.withLock(key, async () => {
      const stored = await this.read(key);
      if (!stored && seriesAction === "continue") {
        throw new EditorConsolidatorStateError(
          "EDITOR_CONTEXT_EXPIRED",
          "Editor consolidator state expired; start a fresh series or reset it",
        );
      }

      if (stored && !sameIdentity(stored.identity, identity)) {
        throw new EditorConsolidatorStateError(
          "INVALID_CONSOLIDATOR_STATE",
          "Stored editor consolidator ownership is invalid",
        );
      }

      const previousOperation = stored?.operations[operationId];
      if (previousOperation) {
        if (previousOperation.requestFingerprint !== requestFingerprint) {
          throw new EditorConsolidatorStateError(
            "DUPLICATE_OPERATION_CONFLICT",
            "operationId was already used for a different request",
          );
        }
        return previousOperation.result;
      }

      const continuingState = seriesAction === "continue" ? stored : undefined;
      if (
        continuingState &&
        !sameProvenance(continuingState.sourceProvenance, sourceProvenance)
      ) {
        throw new EditorConsolidatorStateError(
          "EDITOR_CONTEXT_RESET_REQUIRED",
          "The upstream source series changed; start a fresh series or reset it",
        );
      }

      const next = runConsolidatorStep(
        parameters,
        candleData,
        continuingState?.state,
      );
      const operations = { ...(continuingState?.operations ?? {}) };
      const operationOrder = [
        ...(continuingState?.operationOrder ?? []),
        operationId,
      ];
      operations[operationId] = { requestFingerprint, result: next.payload };
      while (operationOrder.length > MAX_RECORDED_OPERATIONS) {
        const expiredOperationId = operationOrder.shift();
        if (expiredOperationId) delete operations[expiredOperationId];
      }

      const value: StoredEditorState = {
        version: 1,
        identity,
        sourceProvenance,
        state: next.state,
        operations,
        operationOrder,
      };
      await this.redis.setex(
        key,
        EDITOR_CONSOLIDATOR_STATE_TTL_SECONDS,
        JSON.stringify(value),
      );
      return next.payload;
    });
  }

  async reset(identity: EditorConsolidatorIdentity): Promise<void> {
    const key = this.buildKey(identity);
    await this.withLock(key, async () => {
      await this.redis.del(key);
    });
  }

  private buildKey(identity: EditorConsolidatorIdentity): string {
    return RedisKeys.editorConsolidator(
      identity.userId,
      identity.workflowId,
      identity.workflowSessionId,
      identity.nodeId,
      identity.configFingerprint,
    );
  }

  private async read(key: string): Promise<StoredEditorState | undefined> {
    const serialized = await this.redis.get(key);
    if (!serialized) return undefined;
    try {
      const value: unknown = JSON.parse(serialized);
      if (!isStoredEditorState(value))
        throw new Error("invalid state envelope");
      return value;
    } catch {
      throw new EditorConsolidatorStateError(
        "INVALID_CONSOLIDATOR_STATE",
        "Stored editor consolidator state is invalid",
      );
    }
  }

  private async withLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${key}:lock`;
    const lockToken = randomUUID();
    const locked = await this.redis.set(
      lockKey,
      lockToken,
      "PX",
      LOCK_TTL_MILLISECONDS,
      "NX",
    );
    if (locked !== "OK") {
      throw new EditorConsolidatorStateError(
        "EXECUTION_CONTEXT_UNAVAILABLE",
        "Editor consolidator state is busy; retry this operation",
      );
    }
    try {
      return await operation();
    } finally {
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        lockToken,
      );
    }
  }
}
