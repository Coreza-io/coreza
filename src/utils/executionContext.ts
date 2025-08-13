// ExecutionContext.ts

export interface NodeExecutionData {
  // I/O
  input?: any;
  output?: any;

  // Loop config / progress
  isLoopNode?: boolean;
  loopItems?: any[];
  batchSize?: number;
  totalItems?: number;
  parallel?: boolean;
  continueOnError?: boolean;
  throttleMs?: number;
  loopIndex?: number;    // next start index
  loopItem?: any;        // last emitted item (preview)

  // Runtime & aggregation
  loopSig?: string;                          // signature to detect input changes
  aggregateMode?: "items" | "returns";       // aggregation semantics
  returnSources?: string[];                  // node IDs that return to this Loop
  aggregated?: any[];                        // accumulated results (items or return payloads)
  finishedByLoop?: boolean;                  // Loop iterated the final batch
  done?: boolean;                            // fully finalized
  forwardedDone?: boolean;                   // optional: if you gate one-time forwarding
  _edgeBuf?: Record<string, any>;            // transient per-iteration edge payloads
}

export class ExecutionContext {
  private store = new Map<string, NodeExecutionData>();

  constructor(initial: Array<{ id: string; data?: NodeExecutionData }> = []) {
    initial.forEach(n => this.store.set(n.id, { ...(n.data || {}) }));
  }

  getNodeData(id: string): NodeExecutionData {
    return this.store.get(id) ?? {};
  }

  setNodeData(id: string, data: Partial<NodeExecutionData>): void {
    const prev = this.store.get(id) ?? {};
    this.store.set(id, { ...prev, ...data });
  }

  /** Clear runtime-only loop fields. */
  resetLoopState(id: string, extra?: Partial<NodeExecutionData>) {
    this.setNodeData(id, {
      loopItems: undefined,
      loopIndex: 0,
      loopItem: undefined,
      aggregated: undefined,
      loopSig: undefined,
      finishedByLoop: false,
      done: false,
      forwardedDone: false,
      ...extra,
    });
    return this.getNodeData(id);
  }

  /** Initialize a loop for iteration. */
  startLoop(
    id: string,
    items: any[],
    opts: {
      batchSize?: number;
      parallel?: boolean;
      continueOnError?: boolean;
      throttleMs?: number;
      loopSig?: string;
      aggregateMode?: "items" | "returns";
      returnSources?: string[];
    } = {}
  ) {
    this.setNodeData(id, {
      isLoopNode: true,
      loopItems: items,
      totalItems: items?.length ?? 0,
      loopIndex: 0,
      loopItem: undefined,
      aggregated: [],
      finishedByLoop: false,
      done: false,
      forwardedDone: false,
      batchSize: opts.batchSize,
      parallel: opts.parallel,
      continueOnError: opts.continueOnError,
      throttleMs: opts.throttleMs,
      loopSig: opts.loopSig,
      aggregateMode: opts.aggregateMode ?? "items",
      returnSources: opts.returnSources ?? [],
    });
    return this.getNodeData(id);
  }

  /**
   * Advance loop progress. In "items" mode we append 'emitted'.
   * In "returns" mode we append 'returnSourceOutputs' (normalized).
   */
  advanceLoop(
    id: string,
    emitted: any | any[],                // current batch or item
    nextIndex: number,
    isFinalBatch: boolean,
    returnSourceOutputs?: any | any[]    // optional: pass the new returns you want to append now
  ) {
    const prev = this.getNodeData(id);
    const prevAgg = Array.isArray(prev.aggregated) ? prev.aggregated : [];

    const asArray = (v: any | any[] | undefined) =>
      v === undefined ? [] : (Array.isArray(v) ? v : [v]);

    let newAggregated = prevAgg;

    const returnsToAppend = asArray(returnSourceOutputs).flat();
    if (returnsToAppend.length > 0) {
      newAggregated = prevAgg.concat(returnsToAppend);
    }


    const patch: Partial<NodeExecutionData> = {
      loopIndex: nextIndex,
      loopItem: asArray(emitted)[0],
      aggregated: newAggregated,
      finishedByLoop: isFinalBatch,
      done: isFinalBatch && prev.aggregateMode === "items", // in returns mode, done flips when returns are present
      // mid-run preview:
      output: prev.aggregateMode === "items"
        ? emitted
        : (newAggregated.length ? newAggregated : emitted), // show returns if any, else show current batch
    };

    // If items mode and final batch → expose full aggregate as output.
    if (isFinalBatch && prev.aggregateMode === "items") {
      patch.output = newAggregated;
      patch.loopItems = undefined;
      patch.loopItem = undefined;
    }

    // If returns mode and loop already finished iterating,
    // make sure output mirrors aggregated when it has content.
    if (prev.aggregateMode === "returns" && isFinalBatch && newAggregated.length > 0) {
      patch.output = newAggregated;
      patch.done = true;
    }

    this.setNodeData(id, patch);
    return this.getNodeData(id);
  }

  /** Called by *returning* nodes to push their outputs into a Loop in 'returns' mode. */
  appendLoopReturn(loopId: string, sourceId: string, payload: any) {
    const st = this.getNodeData(loopId);
    if (st.aggregateMode !== "returns") return;

    const prevAgg = Array.isArray(st.aggregated) ? st.aggregated : [];
    const asArray = (v: any) => (Array.isArray(v) ? v : [v]);
    const nextAgg = prevAgg.concat(asArray(payload));

    const patch: Partial<NodeExecutionData> = { aggregated: nextAgg };

    // If the Loop finished iterating already, mirror aggregate to output.
    if (st.finishedByLoop) {
      patch.output = nextAgg;
      patch.done = true;
    }

    this.setNodeData(loopId, patch);
  }
}

export default ExecutionContext;
