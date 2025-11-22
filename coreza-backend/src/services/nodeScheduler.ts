/**
 * Represents a node scheduled for execution at a specific time
 */
interface ScheduledNode {
  id: string;
  runAt: number; // Timestamp in milliseconds when the node should execute
}

/**
 * NodeScheduler manages time-based execution of workflow nodes
 * Implements a priority queue sorted by execution time for efficient scheduling
 * 
 * @example
 * ```typescript
 * const scheduler = new NodeScheduler();
 * await scheduler.enqueue('node-1', Date.now() + 5000); // Schedule 5 seconds from now
 * const nodeId = await scheduler.dequeue(); // Waits and returns node-1
 * ```
 */
export class NodeScheduler {
  private queue: ScheduledNode[] = [];
  
  /**
   * Priority queue of nodes sorted by execution time (earliest first)
   */

  /**
   * Enqueues a node for execution at a specified time
   * 
   * @param id - Unique identifier of the node to schedule
   * @param throttleUntil - Timestamp when the node should execute (defaults to now)
   * @returns Promise that resolves when the node is enqueued
   */
  async enqueue(id: string, throttleUntil?: number): Promise<void> {
    const runAt = throttleUntil ?? Date.now();
    console.log(`[NodeScheduler] Enqueuing node ${id} to run at ${new Date(runAt).toISOString()}`);
    this.queue.push({ id, runAt });
    this.queue.sort((a, b) => a.runAt - b.runAt);
  }

  /**
   * Dequeues the next node ready for execution
   * Waits if the next node is scheduled for the future
   * 
   * @returns Promise that resolves to the node ID when ready, or undefined if queue is empty
   */
  async dequeue(): Promise<string | undefined> {
    while (this.queue.length) {
      const next = this.queue[0];
      const now = Date.now();
      
      if (next.runAt > now) {
        const waitTime = next.runAt - now;
        console.log(`[NodeScheduler] Waiting ${waitTime}ms for node ${next.id}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      this.queue.shift();
      console.log(`[NodeScheduler] Dequeuing node ${next.id} for execution`);
      return next.id;
    }
    
    console.log('[NodeScheduler] Queue is empty');
    return undefined;
  }

  /**
   * Returns the current number of scheduled nodes in the queue
   */
  get length(): number {
    return this.queue.length;
  }
}
