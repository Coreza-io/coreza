import { QueueItem } from '../nodes/types';

/**
 * Single queue manager with refcounting for loop iterations
 */
export class QueueManager {
  private q: QueueItem[] = [];

  // loopId -> iterIndex -> { pending, drainCallback }
  private loopIters = new Map<string, Map<number, { pending: number; onDrain: () => void }>>();

  enqueue(item: QueueItem) {
    this.q.push(item);
  }

  dequeue(): QueueItem | undefined {
    return this.q.shift();
  }

  get length(): number {
    return this.q.length;
  }

  // mark that a subtree task belonging to (loopId, iterIndex) has started
  inc(loopId?: string, iterIndex?: number) {
    if (!loopId || iterIndex === undefined) return;
    const m = this.loopIters.get(loopId) ?? new Map();
    const st = m.get(iterIndex) ?? { pending: 0, onDrain: () => {} };
    st.pending += 1;
    m.set(iterIndex, st);
    this.loopIters.set(loopId, m);
  }

  // call when that task completes (after you enqueue its children)
  dec(loopId?: string, iterIndex?: number) {
    if (!loopId || iterIndex === undefined) return;
    const m = this.loopIters.get(loopId); if (!m) return;
    const st = m.get(iterIndex); if (!st) return;
    st.pending -= 1;
    if (st.pending === 0) st.onDrain();
  }

  onIterationDrain(loopId: string, iterIndex: number, cb: () => void) {
    const m = this.loopIters.get(loopId) ?? new Map();
    const st = m.get(iterIndex) ?? { pending: 0, onDrain: () => {} };
    st.onDrain = cb;
    m.set(iterIndex, st);
    this.loopIters.set(loopId, m);
  }

  clear() {
    this.q.length = 0;
    this.loopIters.clear();
  }
}