interface ScheduledNode {
  id: string;
  runAt: number;
}

export class NodeScheduler {
  private queue: ScheduledNode[] = [];

  async enqueue(id: string, throttleUntil?: number): Promise<void> {
    const runAt = throttleUntil ?? Date.now();
    this.queue.push({ id, runAt });
    this.queue.sort((a, b) => a.runAt - b.runAt);
  }

  async dequeue(): Promise<string | undefined> {
    while (this.queue.length) {
      const next = this.queue[0];
      const now = Date.now();
      if (next.runAt > now) {
        await new Promise(resolve => setTimeout(resolve, next.runAt - now));
      }
      this.queue.shift();
      return next.id;
    }
    return undefined;
  }

  get length(): number {
    return this.queue.length;
  }
}
