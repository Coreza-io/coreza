/**
 * Queue Manager V2 - Advanced Workflow Execution Queue
 * 
 * Manages workflow node execution with support for loop iterations and reference counting.
 * Ensures proper synchronization of loop-based workflow execution with drain callbacks.
 * 
 * @module QueueManagerV2
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
export class QueueManager {
  /** Main FIFO queue for workflow items */
  private q: QueueItem[] = [];

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
    console.log(`[QueueManager] Enqueuing item: ${item.nodeId}`);
    this.q.push(item);
  }

  /**
   * Removes and returns the next item from the queue
   * @returns Next queue item or undefined if empty
   */
  dequeue(): QueueItem | undefined {
    const item = this.q.shift();
    if (item) {
      console.log(`[QueueManager] Dequeuing item: ${item.nodeId}`);
    }
    return item;
  }

  /**
   * Returns current queue length
   */
  get length(): number {
    return this.q.length;
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
    
    console.log(`[QueueManager] Increment: loop=${loopId}, iter=${iterIndex}, pending=${st.pending}`);
    
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
    console.log(`[QueueManager] Decrement: loop=${loopId}, iter=${iterIndex}, pending=${st.pending}`);
    
    if (st.pending === 0) {
      console.log(`[QueueManager] Iteration drained: loop=${loopId}, iter=${iterIndex}`);
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
    console.log(`[QueueManager] Registering drain callback: loop=${loopId}, iter=${iterIndex}`);
    
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
    console.log('[QueueManager] Clearing queue and loop iteration tracking');
    this.q.length = 0;
    this.loopIters.clear();
  }
}