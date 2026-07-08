import { CorezaMarketEvent } from "../types/marketEvent";

const ONE_MINUTE_MS = 60_000;
const TIMEFRAME = "1m";

interface OpenBucket {
  workflowId: string;
  stream: string;
  bucketStart: number;
  startCumVolume?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  lastCumVolume?: number;
  event: CorezaMarketEvent;
}

export interface ClosedTickBar {
  workflowId: string;
  stream: string;
  event: CorezaMarketEvent;
}

function toFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getEventTime(event: CorezaMarketEvent): number {
  if (typeof event.t === "number" && Number.isFinite(event.t)) return event.t;
  if (typeof event.t === "string") {
    const parsed = Date.parse(event.t);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function getPrice(event: CorezaMarketEvent): number | undefined {
  // For a tick, the current price is the last-traded price (p / LTP).
  // c is the day/previous close on Dhan full packets (near-constant), so it must not win.
  return toFiniteNumber(event.p ?? event.c);
}

function getVolume(event: CorezaMarketEvent): number | undefined {
  return toFiniteNumber(event.v);
}

function cloneBarEvent(bucket: OpenBucket): CorezaMarketEvent {
  const volume =
    bucket.startCumVolume !== undefined && bucket.lastCumVolume !== undefined
      ? Math.max(0, bucket.lastCumVolume - bucket.startCumVolume)
      : undefined;

  return {
    ...bucket.event,
    type: "bar",
    timeframe: TIMEFRAME,
    isClosed: true,
    t: bucket.bucketStart,
    o: bucket.open,
    h: bucket.high,
    l: bucket.low,
    c: bucket.close,
    ...(volume !== undefined ? { v: volume } : {}),
  };
}

export class TickBarAggregator {
  private buckets = new Map<string, OpenBucket>();

  push(
    workflowId: string,
    stream: string,
    event: CorezaMarketEvent,
  ): CorezaMarketEvent | null {
    const price = getPrice(event);
    if (price === undefined) return null;

    const eventTime = getEventTime(event);
    const bucketStart = Math.floor(eventTime / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    const key = this.key(workflowId, stream);
    const current = this.buckets.get(key);

    if (!current) {
      this.buckets.set(
        key,
        this.openBucket(workflowId, stream, bucketStart, price, event),
      );
      return null;
    }

    if (bucketStart > current.bucketStart) {
      const closed = cloneBarEvent(current);
      this.buckets.set(
        key,
        this.openBucket(workflowId, stream, bucketStart, price, event),
      );
      return closed;
    }

    if (bucketStart === current.bucketStart) {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.lastCumVolume = getVolume(event) ?? current.lastCumVolume;
      current.event = { ...current.event, ...event };
    }

    return null;
  }

  flushDue(now: number): ClosedTickBar[] {
    const closed: ClosedTickBar[] = [];
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.bucketStart + ONE_MINUTE_MS > now) continue;
      closed.push({
        workflowId: bucket.workflowId,
        stream: bucket.stream,
        event: cloneBarEvent(bucket),
      });
      this.buckets.delete(key);
    }
    return closed;
  }

  dispose(workflowId: string): void {
    const prefix = `${workflowId}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }

  private openBucket(
    workflowId: string,
    stream: string,
    bucketStart: number,
    price: number,
    event: CorezaMarketEvent,
  ): OpenBucket {
    const cumVolume = getVolume(event);
    return {
      workflowId,
      stream,
      bucketStart,
      startCumVolume: cumVolume,
      open: price,
      high: price,
      low: price,
      close: price,
      lastCumVolume: cumVolume,
      event: { ...event },
    };
  }

  private key(workflowId: string, stream: string): string {
    return `${workflowId}:${stream}`;
  }
}
