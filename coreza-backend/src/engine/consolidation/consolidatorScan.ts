import type { DataContext } from "../DataContext";
import logger from "../../utils/logger";
import { consolidatorInvalidStatesCounter } from "../../utils/metrics";
import { TimeBarConsolidator, type ConsolidatorState } from "./TimeBarConsolidator";
import {
  isConsolidatorState,
  type ConsolidatorPayload,
  type ConsolidatorParameters,
} from "./consolidatorShared";

export interface ConsolidatorEmission {
  nodeId: string;
  emissionId: string;
  payload: ConsolidatorPayload;
  readonly pendingCommit?: { ref: string; state: ConsolidatorState; metadata: ConsolidatorMetadata };
}

export interface ConsolidatorScanOptions {
  nodeId?: string;
  commit?: boolean;
  graceMs?: number;
}

interface ConsolidatorMetadata {
  kind: "consolidator_state";
  nodeId: string;
  symbol: string;
  sourceTimeframe: string;
  targetTimeframe: string;
  timezone: string;
  anchorTime: string;
  scanGraceMs?: number;
}

function isMetadata(value: unknown): value is ConsolidatorMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<ConsolidatorMetadata>;
  return metadata.kind === "consolidator_state" &&
    [metadata.nodeId, metadata.symbol, metadata.sourceTimeframe, metadata.targetTimeframe,
      metadata.timezone, metadata.anchorTime].every((part) => typeof part === "string") &&
    (metadata.scanGraceMs === undefined ||
      (Number.isFinite(metadata.scanGraceMs) && metadata.scanGraceMs >= 0));
}

/** Discovers registered expiries in deterministic order; callers may defer state commit until delivery. */
export function scanConsolidators(
  dataContext: DataContext,
  scanTime: string | number | Date,
  nodeIdOrOptions?: string | ConsolidatorScanOptions,
): ConsolidatorEmission[] {
  const options = typeof nodeIdOrOptions === "string"
    ? { nodeId: nodeIdOrOptions, commit: true }
    : { commit: true, ...nodeIdOrOptions };
  const scanTimestamp = new Date(scanTime);
  if (Number.isNaN(scanTimestamp.getTime())) {
    throw new Error(`Invalid scan timestamp: ${String(scanTime)}`);
  }
  const emissions: Array<ConsolidatorEmission & { endTimestamp: string; symbol: string }> = [];
  for (const ref of dataContext.listDataRefs()) {
    if (!isMetadata(ref.meta)) continue;
    const metadata = ref.meta;
    if (options.nodeId !== undefined && metadata.nodeId !== options.nodeId) continue;
    const storedState: unknown = dataContext.getDataByKey(ref.ref);
    if (!isConsolidatorState(storedState)) {
      consolidatorInvalidStatesCounter.inc();
      logger.error({ nodeId: metadata.nodeId, ref: ref.ref }, "Skipping invalid consolidator state");
      continue;
    }
    const state: ConsolidatorState = storedState;
    const parameters: ConsolidatorParameters = metadata;
    const graceMs = metadata.scanGraceMs ?? options.graceMs ?? 0;
    const effectiveScanTimestamp = new Date(scanTimestamp.getTime() - graceMs);
    const result = new TimeBarConsolidator(parameters).scan(effectiveScanTimestamp, state);
    if (!result.emitted) continue;
    if (options.commit) dataContext.setData(ref.ref, result.state, metadata);
    const emissionId = `${dataContext.getExecutionId()}:${metadata.nodeId}:${metadata.symbol}:${result.emitted.endTimestamp}`;
    emissions.push({
      nodeId: metadata.nodeId,
      emissionId,
      pendingCommit: options.commit ? undefined : { ref: ref.ref, state: result.state, metadata },
      endTimestamp: result.emitted.endTimestamp,
      symbol: metadata.symbol,
      payload: {
        emissionId,
        emitted: true,
        bar: result.emitted,
        workingBar: null,
        emissionReason: "time_scan",
        emittedAt: result.emittedAt ?? effectiveScanTimestamp.toISOString(),
        symbol: metadata.symbol,
        sourceTimeframe: metadata.sourceTimeframe,
        targetTimeframe: metadata.targetTimeframe,
      },
    });
  }
  emissions.sort((a, b) => a.endTimestamp.localeCompare(b.endTimestamp) ||
    a.nodeId.localeCompare(b.nodeId) || a.symbol.localeCompare(b.symbol));
  return emissions.map(({ nodeId, emissionId, payload, pendingCommit }) => ({ nodeId, emissionId, payload, pendingCommit }));
}

export function commitConsolidatorEmissions(
  dataContext: DataContext,
  emissions: readonly ConsolidatorEmission[],
): void {
  for (const emission of emissions) {
    const commit = emission.pendingCommit;
    if (commit) dataContext.setData(commit.ref, commit.state, commit.metadata);
  }
}
