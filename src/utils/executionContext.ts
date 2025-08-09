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
  loopIndex?: number; // next start index
  loopItem?: any; // last emitted item (preview)

  // Runtime & aggregation
  loopSig?: string; // signature to detect input-array changes
  aggregateMode?: "items" | "returns";
  returnSources?: string[]; // node IDs that return to this Loop
  aggregated?: any[]; // accumulated results (items or return payloads)
  finishedByLoop?: boolean; // Loop iterated the final batch
  done?: boolean; // fully finalized
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

  /** Append an emitted batch (items mode) and finalize on last batch. */
  advanceLoop(
    id: string,
    emitted: any | any[],
    nextIndex: number,
    isFinalBatch: boolean
  ) {
    const prev = this.getNodeData(id);
    const prevAgg = Array.isArray(prev.aggregated) ? prev.aggregated : [];
    const toAppend = Array.isArray(emitted) ? emitted : [emitted];

    const patch: Partial<NodeExecutionData> = {
      loopIndex: nextIndex,
      loopItem: toAppend[0],
      aggregated: prevAgg.concat(toAppend),
      output: emitted, // for mid-run preview
      finishedByLoop: isFinalBatch,
      done: isFinalBatch && prev.aggregateMode === "items",
    };

    // If items mode and final batch → expose full aggregate as output.
    if (isFinalBatch && prev.aggregateMode === "items") {
      patch.output = prevAgg.concat(toAppend);
      patch.loopItems = undefined;
      patch.loopItem = undefined;
    }

    this.setNodeData(id, patch);
    return this.getNodeData(id);
  }

  /** Called by *returning* nodes to push their outputs into a Loop in 'returns' mode. */
  appendLoopReturn(loopId: string, sourceId: string, payload: any) {
    const st = this.getNodeData(loopId);
    if (st.aggregateMode !== "returns") return;

    const prevAgg = Array.isArray(st.aggregated) ? st.aggregated : [];
    const nextAgg = prevAgg.concat(payload);

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
