import { QueueManager } from './queueManagerV2';
import { QueueItem } from '../nodes/types';
import { NodeRouter } from './router';
import { NodeStoreV2 } from './nodeStoreV2'; // enhanced node store

/**
 * Loop handler for single-tick loop processing
 */
export class LoopHandler {
  constructor(
    private store: NodeStoreV2,
    private router: NodeRouter,
    private queue: QueueManager,
    private throttleMs = 0
  ) {}

  async tick(loopId: string, input: any) {
    // 1) normalize/ensure loop state
    const st = this.store.ensureLoopState(loopId, input);
    const { loopItems, loopIndex, batchSize } = st;

    const maxLoopIndex = Math.ceil(loopItems.length / batchSize) - 1;
    if (loopItems.length === 0) {
      // nothing to do → finish immediately
      this.store.finishLoop(loopId);
      // fire done edges
      const finalOut = this.store.getAggregated(loopId) ?? [];
      for (const e of this.router.doneEdges(loopId)) {
        this.queue.enqueue({ nodeId: e.target, input: finalOut });
      }
      return;
    }

    // 2) pick current batch (NOTE: batch index * size)
    const start = loopIndex * batchSize;
    const currentBatch = loopItems.slice(start, start + batchSize);

    // 3) advance loop index (we're consuming this batch now)
    this.store.advanceLoop(loopId, currentBatch);

    // 4) body edges fire with current batch as payload
    const iterIndex = loopIndex; // this tick's index (before increment)
    const originMeta = { originLoopId: loopId, iterIndex };

    const bodyEdges = this.router.loopBodyEdges(loopId);
    if (bodyEdges.length === 0) {
      // degenerate loop body → immediately re-enter next tick (or finish)
      await this.afterBodyDrain(loopId, iterIndex);
      return;
    }

    // register drain: when subtree drains, enqueue next tick
    this.queue.onIterationDrain(loopId, iterIndex, async () => {
      await this.afterBodyDrain(loopId, iterIndex);
    });

    // spawn the body subtree (refcount it)
    for (const e of bodyEdges) {
      this.queue.inc(loopId, iterIndex);
      this.queue.enqueue({ nodeId: e.target, input: currentBatch, meta: originMeta });
    }
  }

  private async afterBodyDrain(loopId: string, iterIndex: number) {
    if (this.throttleMs) await new Promise(r => setTimeout(r, this.throttleMs));

    // read feedback buffered into the loop by body nodes (see Step 6)
    const arrivals = this.store.consumeEdgeBuf(loopId); // returns array or {}
    this.store.appendAggregate(loopId, arrivals);

    // finished?
    const s = this.store.getLoopState(loopId)!;
    const atEnd = s.loopIndex > Math.ceil(s.loopItems.length / s.batchSize) - 1;

    if (atEnd) {
      this.store.finishLoop(loopId);
      const finalOut = this.store.getAggregated(loopId) ?? [];
      for (const e of this.router.doneEdges(loopId)) {
        this.queue.enqueue({ nodeId: e.target, input: finalOut });
      }
      return;
    }

    // not finished → enqueue **next** tick
    this.queue.enqueue({ nodeId: loopId, input: s.loopItems, meta: { originLoopId: loopId, iterIndex: s.loopIndex } });
  }
}