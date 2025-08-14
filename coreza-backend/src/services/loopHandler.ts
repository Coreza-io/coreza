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
    private queue: QueueManager
  ) {}

  async tick(loopId: string, input: any) {
    // Get loop node configuration
    const loopNode = this.store.getNodeDef(loopId);
    const config = this.parseLoopConfig(loopNode);
    
    // 1) normalize/ensure loop state with configuration
    const st = this.store.ensureLoopState(loopId, input, config);
    const { loopItems, loopIndex, batchSize, parallel, continueOnError } = st;

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

    // spawn the body subtree with N8N-style item context
    if (parallel) {
      // Parallel execution - fire all items at once
      for (let i = 0; i < currentBatch.length; i++) {
        const itemWithContext = this.addItemContext(currentBatch[i], iterIndex, i, currentBatch.length);
        for (const e of bodyEdges) {
          this.queue.inc(loopId, iterIndex);
          this.queue.enqueue({ 
            nodeId: e.target, 
            input: [itemWithContext], 
            meta: { ...originMeta, itemIndex: i, parallel: true }
          });
        }
      }
    } else {
      // Sequential execution - fire batch as group
      const batchWithContext = currentBatch.map((item, i) => 
        this.addItemContext(item, iterIndex, i, currentBatch.length)
      );
      for (const e of bodyEdges) {
        this.queue.inc(loopId, iterIndex);
        this.queue.enqueue({ 
          nodeId: e.target, 
          input: batchWithContext, 
          meta: originMeta 
        });
      }
    }
  }

  private parseLoopConfig(loopNode: any) {
    const values = loopNode?.values || loopNode?.data?.values || {};
    return {
      batchSize: parseInt(values.batchSize) || 1,
      parallel: !!values.parallel,
      continueOnError: !!values.continueOnError,
      throttleMs: parseInt(values.throttleMs) || 200,
      inputArray: values.inputArray || 'items'
    };
  }

  private addItemContext(item: any, iterIndex: number, itemIndex: number, batchSize: number) {
    // Add N8N-style loop context to each item
    return {
      ...item,
      $loopContext: {
        iterationIndex: iterIndex,
        itemIndex: itemIndex,
        batchSize: batchSize,
        isFirstItem: itemIndex === 0,
        isLastItem: itemIndex === batchSize - 1
      }
    };
  }

  private async afterBodyDrain(loopId: string, iterIndex: number) {
    const loopNode = this.store.getNodeDef(loopId);
    const config = this.parseLoopConfig(loopNode);
    
    if (config.throttleMs) await new Promise(r => setTimeout(r, config.throttleMs));

    // read feedback buffered into the loop by body nodes
    const arrivals = this.store.consumeEdgeBuf(loopId);
    
    // Handle error recovery if continueOnError is enabled
    if (config.continueOnError) {
      const validArrivals = arrivals.filter((arrival: any) => {
        if (arrival && typeof arrival === 'object' && arrival.error) {
          console.warn(`⚠️ [LOOP] Skipping failed item in iteration ${iterIndex}:`, arrival.error);
          return false;
        }
        return true;
      });
      this.store.appendAggregate(loopId, validArrivals);
    } else {
      // Check for errors and fail the loop if any
      const hasErrors = arrivals.some((arrival: any) => 
        arrival && typeof arrival === 'object' && arrival.error
      );
      if (hasErrors) {
        const error = arrivals.find((a: any) => a?.error)?.error;
        this.store.setNodeError(loopId, `Loop failed at iteration ${iterIndex}: ${error}`);
        return;
      }
      this.store.appendAggregate(loopId, arrivals);
    }

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
    this.queue.enqueue({ 
      nodeId: loopId, 
      input: s.loopItems, 
      meta: { originLoopId: loopId, iterIndex: s.loopIndex } 
    });
  }
}