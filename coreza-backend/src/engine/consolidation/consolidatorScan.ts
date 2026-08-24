import type { DataContext } from "../DataContext";
import { TimeBarConsolidator, type ConsolidatorState } from "./TimeBarConsolidator";
import {
  ConsolidatorValidationError,
  isConsolidatorState,
  type ConsolidatorPayload,
  type ConsolidatorParameters,
} from "./consolidatorShared";

export interface ConsolidatorEmission {
  nodeId: string;
  payload: ConsolidatorPayload;
}

interface ConsolidatorMetadata {
  kind: "consolidator_state";
  nodeId: string;
  symbol: string;
  sourceTimeframe: string;
  targetTimeframe: string;
  timezone: string;
  anchorTime: string;
}

function isMetadata(value: unknown): value is ConsolidatorMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<ConsolidatorMetadata>;
  return metadata.kind === "consolidator_state" &&
    [metadata.nodeId, metadata.symbol, metadata.sourceTimeframe, metadata.targetTimeframe,
      metadata.timezone, metadata.anchorTime].every((part) => typeof part === "string");
}

/** Scans registered states in deterministic order and persists each expiry before returning it. */
export function scanConsolidators(
  dataContext: DataContext,
  scanTime: string | number | Date,
  nodeId?: string,
): ConsolidatorEmission[] {
  const scanTimestamp = new Date(scanTime);
  if (Number.isNaN(scanTimestamp.getTime())) {
    throw new Error(`Invalid scan timestamp: ${String(scanTime)}`);
  }
  const emissions: Array<ConsolidatorEmission & { endTimestamp: string; symbol: string }> = [];
  for (const ref of dataContext.listDataRefs()) {
    if (!isMetadata(ref.meta)) continue;
    const metadata = ref.meta;
    if (nodeId !== undefined && metadata.nodeId !== nodeId) continue;
    const storedState: unknown = dataContext.getDataByKey(ref.ref);
    if (!isConsolidatorState(storedState)) {
      throw new ConsolidatorValidationError(
        "INVALID_CONSOLIDATOR_STATE",
        `Stored consolidator state is invalid for node ${metadata.nodeId}`,
      );
    }
    const state: ConsolidatorState = storedState;
    const parameters: ConsolidatorParameters = metadata;
    const result = new TimeBarConsolidator(parameters).scan(scanTimestamp, state);
    if (!result.emitted) continue;
    dataContext.setData(ref.ref, result.state, metadata);
    emissions.push({
      nodeId: metadata.nodeId,
      endTimestamp: result.emitted.endTimestamp,
      symbol: metadata.symbol,
      payload: {
        emitted: true,
        bar: result.emitted,
        workingBar: null,
        emissionReason: "time_scan",
        emittedAt: result.emittedAt ?? scanTimestamp.toISOString(),
        symbol: metadata.symbol,
        sourceTimeframe: metadata.sourceTimeframe,
        targetTimeframe: metadata.targetTimeframe,
      },
    });
  }
  emissions.sort((a, b) => a.endTimestamp.localeCompare(b.endTimestamp) ||
    a.nodeId.localeCompare(b.nodeId) || a.symbol.localeCompare(b.symbol));
  return emissions.map(({ nodeId, payload }) => ({ nodeId, payload }));
}
