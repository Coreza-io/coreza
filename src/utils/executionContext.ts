/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

// ExecutionContext.ts

export interface NodeExecutionData {
  // I/O
  input?: any;
  output?: any;
  sourceRunId?: string;

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
  aggregateMode?: boolean;                   // aggregation semantics
  returnSources?: string[];                  // node IDs that return to this Loop
  aggregated?: any[];                        // accumulated results (items or return payloads)
  finishedByLoop?: boolean;                  // Loop iterated the final batch
  done?: boolean;                            // fully finalized
  forwardedDone?: boolean;                   // optional: if you gate one-time forwarding
  _edgeBuf?: Record<string, any>;            // transient per-iteration edge payloads
  
  // Streaming state
  isStreamingWaiting?: boolean;              // waiting for streaming data
  isListening?: boolean;                     // node is actively listening for events
  isTestListening?: boolean;                 // test listening mode (webhook-like)
  testListenWorkflowId?: string;             // workflow ID for test listener
  testListenNodeId?: string;                 // node ID for test listener
  testListenSource?: string;                 // broker source for stream filtering
  streamDataReceived?: boolean;              // true when stream data just arrived (for flash animation)
  isStreamPaused?: boolean;                  // client-side pause: skip UI updates while stream stays alive
  isStreamStepping?: boolean;                // true while user is stepping event-by-event
  lastStreamEntryId?: string;                // Redis stream Entry ID of last displayed event
}

export class ExecutionContext {
  private store = new Map<string, NodeExecutionData>();
  private pinnedOutputs = new Map<string, unknown>();
  private dirtyNodes = new Set<string>();
  private nodeListeners = new Map<string, Set<() => void>>();
  version = 0;
  private nodeVersions = new Map<string, number>();
  getNodeVersion(id: string): number { return this.nodeVersions.get(id) ?? 0; }

  subscribeNode(id: string, listener: () => void): () => void {
    const listeners = this.nodeListeners.get(id) ?? new Set<() => void>();
    listeners.add(listener);
    this.nodeListeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.nodeListeners.delete(id);
    };
  }

  /** Stage writes first; the existing explicit notification commits the transaction. */
  flushNotifications(): void {
    const dirty = [...this.dirtyNodes];
    this.dirtyNodes.clear();
    this.version += 1;
    dirty.forEach(id => {
      if (this.store.has(id)) this.nodeVersions.set(id, this.version);
      else this.nodeVersions.delete(id);
      this.nodeListeners.get(id)?.forEach(listener => listener());
    });
  }

  /** Session replacement drops pins too; Clear Runtime deliberately retains them. */
  dispose(): void {
    for (const id of this.store.keys()) this.dirtyNodes.add(id);
    this.store.clear();
    this.pinnedOutputs.clear();
    this.nodeVersions.clear();
  }

  retireNode(id: string): void {
    this.store.delete(id);
    this.pinnedOutputs.delete(id);
    this.dirtyNodes.add(id);
  }
  
  // CRITICAL FIX: Expose store for ID checking
  get storeMap() {
    return this.store;
  }

  constructor(initial: Array<{ id: string; data?: NodeExecutionData }> = []) {
    initial.forEach(n => this.store.set(n.id, { ...(n.data || {}) }));
  }

  getNodeData(id: string): NodeExecutionData {
    return this.store.get(id) ?? {};
  }

  setNodeData(id: string, data: Partial<NodeExecutionData>): void {
    const previous = this.store.get(id);
    const patch = this.pinnedOutputs.has(id) && Object.prototype.hasOwnProperty.call(data, "output")
      ? { ...data, output: this.pinnedOutputs.get(id) } : data;
    if (previous && Object.keys(patch).every(key => Object.prototype.hasOwnProperty.call(previous, key)
      && Object.is((previous as Record<string, unknown>)[key], (patch as Record<string, unknown>)[key]))) return;
    this.store.set(id, { ...previous, ...patch });
    this.dirtyNodes.add(id);
  }

  setPinned(id: string, value: unknown | null): boolean {
    if (value === null && !this.pinnedOutputs.has(id)) return false;
    if (value !== null && this.pinnedOutputs.has(id) && Object.is(this.pinnedOutputs.get(id), value)) return false;
    this.dirtyNodes.add(id);
    if (value === null) {
      this.pinnedOutputs.delete(id);
      return true;
    }

    this.pinnedOutputs.set(id, value);
    const prev = this.store.get(id) ?? {};
    this.store.set(id, { ...prev, output: value });
    return true;
  }

  canRenameNode(oldId: string, newId: string): boolean {
    if (oldId === newId) return true;
    return !this.store.has(newId) && !this.pinnedOutputs.has(newId);
  }

  renameNode(oldId: string, newId: string): void {
    if (oldId === newId) return;
    if (!this.canRenameNode(oldId, newId)) throw new Error(`Runtime data already exists for node ${newId}.`);
    const hasData = this.store.has(oldId);
    const data = this.store.get(oldId);
    const hasPinned = this.pinnedOutputs.has(oldId);
    const pinned = this.pinnedOutputs.get(oldId);
    if (hasData && data) this.store.set(newId, data);
    if (hasPinned) this.pinnedOutputs.set(newId, pinned);
    this.dirtyNodes.add(oldId);
    this.dirtyNodes.add(newId);
    if (hasData) this.store.delete(oldId);
    if (hasPinned) this.pinnedOutputs.delete(oldId);
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
      aggregateMode?: boolean;
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
      aggregateMode: opts.aggregateMode,
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
      done: isFinalBatch,         
      // mid-run preview:
      output: emitted,
    };

    // If items mode and final batch → expose full aggregate as output.
    if (isFinalBatch) {
      patch.output = newAggregated;
      patch.loopItems = undefined;
      patch.loopItem = undefined;
    }

    // If returns mode and loop already finished iterating,
    // make sure output mirrors aggregated when it has content.
    if (isFinalBatch && newAggregated.length > 0) {
      patch.output = newAggregated;
      patch.done = true;
    }

    this.setNodeData(id, patch);
    return this.getNodeData(id);
  }

  /** Called by *returning* nodes to push their outputs into a Loop in 'returns' mode. */
  appendLoopReturn(loopId: string, sourceId: string, payload: any) {
    const st = this.getNodeData(loopId);

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

  /** Clear transient execution data while retaining registered pinned outputs. */
  clear() {
    for (const id of this.store.keys()) this.dirtyNodes.add(id);
    this.store.clear();
    this.pinnedOutputs.forEach((output, id) => {
      this.store.set(id, { output });
    });
  }
}

export default ExecutionContext;
