/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/** Browser-safe node results. Workflow-run, HTTP and provider envelopes are separate contracts. */
export type ResultStatus = "pending" | "running" | "success" | "error" | "waiting" | "listening" | "streaming" | "skipped" | "cancelled" | "not-executed";
export interface ResultErrorDetails {
  code?: string;
  provider?: string;
  status?: number;
  recoverable?: boolean;
  reason?: string;
  response?: Record<string, string | number | boolean | null>;
}
export interface ResultMeta {
  timestamp?: string;
  executionTime?: number;
  durationMs?: number;
  nodeId?: string;
  nodeName?: string;
  category?: string;
  runId?: string;
  invocationId?: string;
  cached?: boolean;
  persistentVariableKeys?: string[];
  smoothing?: string;
  series?: unknown[];
  requiredBars?: number;
  [key: string]: unknown;
}
export interface RuntimeControl {
  suppressRouting?: boolean;
  ownedNodeResults?: Record<string, NodeResult>;
  ownedExecutionOrder?: string[];
  requeueSelf?: boolean;
  throttleUntil?: number;
  setState?: Record<string, any>;
  branch?: "true" | "false";
  loopCompleted?: boolean;
  loopIteration?: boolean;
  parallelDistributed?: boolean;
  sourceHandle?: string;
  currentIndex?: number;
  isLastBatch?: boolean;
  itemCount?: number;
  loopId?: string;
  maxConcurrency?: number;
  continueOnError?: boolean;
  cancelled?: boolean;
}
export interface NodeResult<T = any> {
  status: ResultStatus;
  data: T | null;
  error?: string;
  details?: ResultErrorDetails;
  meta?: ResultMeta;
  control?: RuntimeControl;
  warmupSuppressed?: boolean;
}
export type ResultOptions = Pick<NodeResult, "details" | "meta" | "control" | "warmupSuppressed">;
export interface NormalizeContext {
  nodeId?: string; nodeName?: string; category?: string; runId?: string; invocationId?: string;
  startTime?: number; timestamp?: string; executionTime?: number; skipTimestamp?: boolean;
}
export type LegacySource = "executor" | "manual" | "history" | "pin" | "listener" | "payload";
const statuses: readonly string[] = ["pending", "running", "success", "error", "waiting", "listening", "streaming", "skipped", "cancelled", "not-executed"];
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
export function isNodeResult(value: unknown): value is NodeResult {
  return record(value) && statuses.includes(value.status) && owns(value, "data") && value.data !== undefined && !owns(value, "success") && !owns(value, "formatVersion")
    && (value.error === undefined || typeof value.error === "string")
    && Object.keys(value).every(key => ["status", "data", "error", "details", "meta", "control", "warmupSuppressed"].includes(key));
}
export const isFailedResult = (result: NodeResult): boolean => result.status === "error";
export const isCompletedResult = (result: NodeResult): boolean => ["success", "error", "skipped", "cancelled", "not-executed"].includes(result.status);
export const isSuccessfulResult = (result: NodeResult): boolean => result.status === "success";
export const getNodePayload = <T>(result: NodeResult<T>): T | null => result.data;
export const getNodeDiagnostic = (result: NodeResult) => result.error === undefined && result.details === undefined ? undefined : { message: result.error, ...result.details };
export function resultState<T>(status: ResultStatus, data: T, options: ResultOptions = {}): NodeResult<T> {
  return { status, data: data === undefined ? null : data, ...options };
}
export const resultSuccess = <T>(data: T, options: ResultOptions = {}): NodeResult<T> => resultState("success", data, options);
export function resultFailure(message: string, options: ResultOptions & { data?: any } = {}): NodeResult {
  const { data = null, ...rest } = options;
  return { status: "error", data, error: message, ...rest };
}
/** Only explicitly permitted scalar response diagnostics cross a public boundary. */
export function safeErrorDetails(value: unknown): ResultErrorDetails | undefined {
  if (!record(value)) return undefined;
  const details: ResultErrorDetails = {};
  for (const key of ["code", "provider", "reason"] as const) if (typeof value[key] === "string") details[key] = value[key];
  if (typeof value.status === "number" && Number.isFinite(value.status)) details.status = value.status;
  if (typeof value.recoverable === "boolean") details.recoverable = value.recoverable;
  if (record(value.response)) {
    const response: NonNullable<ResultErrorDetails["response"]> = {};
    for (const key of ["message", "error", "code", "status", "reason", "requestId"]) {
      const field = value.response[key];
      if (field === null || typeof field === "string" || typeof field === "boolean" || (typeof field === "number" && Number.isFinite(field))) response[key] = field;
    }
    if (Object.keys(response).length) details.response = Object.keys(response).length === Object.keys(value.response).length
      && Object.keys(response).every(key => Object.is(response[key], value.response[key])) ? value.response : response;
  }
  if (!Object.keys(details).length) return undefined;
  return Object.keys(details).length === Object.keys(value).length
    && Object.keys(details).every(key => Object.is(details[key as keyof ResultErrorDetails], value[key])) ? value as ResultErrorDetails : details;
}
/** Decode only at an identified result ingress. Explicit payloads never undergo shape guessing. */
export function decodeLegacyNodeResult(value: unknown, source: LegacySource): NodeResult {
  if (source === "payload") return resultSuccess(value);
  if (isNodeResult(value)) return value;
  if (!record(value)) return resultSuccess(value);
  const status = typeof value.status === "string" ? value.status.toLowerCase() : undefined;
  const message = typeof value.error === "string" ? value.error : typeof value.error?.message === "string" ? value.error.message : undefined;
  const hasLifecycle = status !== undefined && (statuses.includes(status) || ["failed", "timeout", "expired"].includes(status));
  // A bare provider {data, pagination} is payload, even at a manual ingress.
  const legacyEnvelope = typeof value.success === "boolean" || hasLifecycle || Boolean(message)
    || ((source === "executor" || source === "history") && owns(value, "data") && Object.keys(value).every(key => ["data", "meta", "control", "warmupSuppressed"].includes(key)));
  if (!legacyEnvelope) return resultSuccess(value);
  const failed = value.success === false || Boolean(message) || ["error", "failed", "timeout", "expired"].includes(status ?? "");
  const terminalNonFailure = status === "cancelled" || status === "not-executed";
  const resolvedStatus: ResultStatus = terminalNonFailure ? status as "cancelled" | "not-executed" : failed ? "error" : hasLifecycle ? status as ResultStatus : "success";
  const contradiction = (value.success === false && status === "success") || (value.success === true && ["error", "failed"].includes(status ?? ""));
  const details = safeErrorDetails({ ...(contradiction ? { code: "LEGACY_CONTRADICTORY_STATUS" } : {}), ...value.details,
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    ...(typeof value.recoverable === "boolean" ? { recoverable: value.recoverable } : {}),
    ...(["timeout", "expired"].includes(status ?? "") ? { code: status === "timeout" ? "LISTENER_TIMEOUT" : "LISTENER_EXPIRED" } : {}),
  });
  const extras = Object.fromEntries(Object.entries(value).filter(([key]) => !["success", "status", "data", "error", "details", "meta", "control", "warmupSuppressed", "code", "provider", "recoverable", "formatVersion"].includes(key)));
  const legacyFields = Object.fromEntries(Object.entries(extras).filter(([key]) => ["pagination", "cursor", "nextCursor", "total", "count", "channels", "callback_url", "subscriptionType", "index", "isLastBatch", "result", "source", "symbols", "message", "receivedAt", "lastReceivedAt"].includes(key)));
  const capturedTimestamp = typeof value.meta?.timestamp === "string" ? undefined : typeof value.timestamp === "string" ? value.timestamp
    : source === "listener" ? value.receivedAt ?? value.lastReceivedAt ?? value.startedAt ?? value.subscribedAt : undefined;
  const hasLegacyFields = owns(value, "data") && Object.keys(legacyFields).length > 0;
  const data = owns(value, "data") ? value.data : Object.keys(extras).length ? extras : null;
  const result = resultState(resolvedStatus, data, {
    ...((record(value.meta) || hasLegacyFields || contradiction || typeof capturedTimestamp === "string") ? {
      meta: { ...(record(value.meta) ? value.meta : {}), ...(contradiction ? { legacyStatusConflict: true } : {}), ...(hasLegacyFields ? { legacyFields } : {}),
        ...(typeof capturedTimestamp === "string" ? { timestamp: capturedTimestamp } : {}) },
    } : {}),
    ...(record(value.control) ? { control: value.control } : {}),
    ...(value.warmupSuppressed === true ? { warmupSuppressed: true } : {}), ...(details ? { details } : {}),
  });
  if (message || resolvedStatus === "error") result.error = message ?? (typeof value.message === "string" ? value.message : "Node execution failed");
  return result;
}
/** No clock reads: timing is captured by the invocation owner, never by a reader. */
export function finalizeNodeResult<T>(result: NodeResult<T>, context: NormalizeContext = {}, profile: "hot" | "observed" = "hot"): NodeResult<T> {
  if (profile === "hot") return result;
  const additions: ResultMeta = {};
  for (const key of ["nodeId", "nodeName", "category", "runId", "invocationId", "timestamp", "executionTime"] as const) {
    if (context[key] !== undefined && result.meta?.[key] === undefined) (additions as Record<string, unknown>)[key] = context[key];
  }
  return Object.keys(additions).length ? { ...result, meta: { ...additions, ...result.meta } } : result;
}
export function toPublicNodeResult<T>(result: NodeResult<T>, options: { omitSeries?: boolean } = {}): NodeResult<T> {
  const { control, details: rawDetails, ...publicResult } = result;
  let meta = publicResult.meta;
  if (options.omitSeries && meta && owns(meta, "series")) { const { series, ...rest } = meta; meta = rest; }
  const details = safeErrorDetails(rawDetails);
  if (!owns(result, "control") && details === rawDetails && meta === result.meta) return result;
  return { ...publicResult, ...(meta ? { meta } : {}), ...(details ? { details } : {}) };
}
/** Validate only at real JSON boundaries; unsupported data produces an explicit diagnostic. */
export function serializeNodeResult(result: NodeResult, options: { omitSeries?: boolean } = {}): NodeResult {
  const publicResult = toPublicNodeResult(result, options);
  const ancestors = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean" || value === undefined) return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (value instanceof Date && Number.isFinite(value.getTime())) return;
    if (typeof value !== "object" || ancestors.has(value!)) throw new Error("Unsupported or cyclic node output");
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error("Unsupported node output instance");
    ancestors.add(value!); Object.values(value!).forEach(visit); ancestors.delete(value!);
  };
  try { visit(publicResult); return publicResult; }
  catch { return resultFailure("Node output cannot be serialized", { details: { code: "OUTPUT_NOT_SERIALIZABLE" } }); }
}
export class NodeResultError extends Error {
  constructor(readonly result: NodeResult) { super(result.error ?? "Node execution failed"); this.name = "NodeResultError"; }
}
/** Public persistence projection; call at serialization, never in the per-node execution loop. */
export function serializeNodeResults(results: Record<string, unknown>): Record<string, NodeResult> {
  return Object.fromEntries(Object.entries(results).map(([id, value]) => [id, serializeNodeResult(decodeLegacyNodeResult(value, "history"))]));
}
