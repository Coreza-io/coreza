/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * Node Queue Manager - Advanced Workflow Execution Queue
 * 
 * Manages workflow node execution with support for loop iterations and reference counting.
 * Ensures proper synchronization of loop-based workflow execution with drain callbacks.
 * 
 * @module NodeQueueManager
 */

import { QueueItem } from '../nodes/types';

/**
 * Single queue manager with reference counting for loop iterations
 * 
 * Features:
 * - FIFO queue for workflow nodes
 * - Reference counting per loop iteration
 * - Drain callbacks when loop iterations complete
 * - Thread-safe iteration tracking
 */
export class NodeQueueManager {
  /** Main FIFO queue for workflow items */
  private q: QueueItem[] = [];
  private head = 0;

  /** 
   * Loop iteration tracking: loopId -> iterIndex -> { pending, drainCallback }
   * Maintains reference count of pending tasks per loop iteration
   */
  private loopIters = new Map<string, Map<number, { pending: number; onDrain: () => void }>>();

  /**
   * Adds an item to the execution queue
   * @param item - Workflow item to enqueue
   */
  enqueue(item: QueueItem) {
    this.q.push(item);
  }

  /**
   * Removes and returns the next item from the queue
   * @returns Next queue item or undefined if empty
   */
  dequeue(): QueueItem | undefined {
    if (this.head >= this.q.length) {
      return undefined;
    }

    const item = this.q[this.head++];

    // Compaction to avoid unbounded growth when queue is heavily used.
    if (this.head > 1024 && this.head * 2 >= this.q.length) {
      this.q = this.q.slice(this.head);
      this.head = 0;
    }

    return item;
  }

  /**
   * Returns current queue length
   */
  get length(): number {
    return this.q.length - this.head;
  }

  /**
   * Increments the pending task counter for a loop iteration
   * Called when a subtree task starts execution
   * 
   * @param loopId - Unique identifier for the loop
   * @param iterIndex - Index of the current iteration
   */
  inc(loopId?: string, iterIndex?: number) {
    if (!loopId || iterIndex === undefined) return;
    
    const m = this.loopIters.get(loopId) ?? new Map();
    const st = m.get(iterIndex) ?? { pending: 0, onDrain: () => {} };
    st.pending += 1;


    m.set(iterIndex, st);
    this.loopIters.set(loopId, m);
  }

  /**
   * Decrements the pending task counter for a loop iteration
   * Called when a task completes (after enqueuing its children)
   * Triggers drain callback if pending count reaches zero
   * 
   * @param loopId - Unique identifier for the loop
   * @param iterIndex - Index of the current iteration
   */
  dec(loopId?: string, iterIndex?: number) {
    if (!loopId || iterIndex === undefined) return;
    
    const m = this.loopIters.get(loopId); 
    if (!m) return;
    
    const st = m.get(iterIndex);
    if (!st) return;

    st.pending -= 1;

    if (st.pending === 0) {
      st.onDrain();
    }
  }

  /**
   * Registers a callback to be invoked when a loop iteration completes
   * The callback fires when the pending count reaches zero
   * 
   * @param loopId - Unique identifier for the loop
   * @param iterIndex - Index of the iteration
   * @param cb - Callback function to invoke on drain
   */
  onIterationDrain(loopId: string, iterIndex: number, cb: () => void) {

    const m = this.loopIters.get(loopId) ?? new Map();
    const st = m.get(iterIndex) ?? { pending: 0, onDrain: () => {} };
    st.onDrain = cb;
    m.set(iterIndex, st);
    this.loopIters.set(loopId, m);
  }

  /**
   * Clears the queue and resets all loop iteration tracking
   * Used for cleanup and reset operations
   */
  clear() {
    this.q.length = 0;
    this.head = 0;
    this.loopIters.clear();
  }
}
