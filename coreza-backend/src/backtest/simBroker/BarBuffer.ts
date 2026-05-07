/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Bar } from "./interfaces";

const DAY_MS = 86_400_000;

export class BarBuffer {
  readonly timestamps: Float64Array;
  readonly open: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly close: Float64Array;
  readonly volume: Float64Array;
  readonly length: number;

  constructor(size: number) {
    this.timestamps = new Float64Array(size);
    this.open = new Float64Array(size);
    this.high = new Float64Array(size);
    this.low = new Float64Array(size);
    this.close = new Float64Array(size);
    this.volume = new Float64Array(size);
    this.length = size;
  }

  static fromBars(bars: Bar[]): BarBuffer {
    const buffer = new BarBuffer(bars.length);
    for (let i = 0; i < bars.length; i++) {
      buffer.set(i, bars[i]);
    }
    return buffer;
  }

  set(index: number, bar: Bar): void {
    this.timestamps[index] = BarBuffer.toEpochMs(bar.timestamp);
    this.open[index] = bar.open;
    this.high[index] = bar.high;
    this.low[index] = bar.low;
    this.close[index] = bar.close;
    this.volume[index] = bar.volume;
  }

  get(index: number): Bar {
    return {
      timestamp: new Date(this.timestamps[index]).toISOString(),
      open: this.open[index],
      high: this.high[index],
      low: this.low[index],
      close: this.close[index],
      volume: this.volume[index],
    };
  }

  static toEpochMs(timestamp: string | number): number {
    return typeof timestamp === "number" ? timestamp : Date.parse(timestamp);
  }

  static dayBucket(timestampMs: number): number {
    return Math.floor(timestampMs / DAY_MS);
  }
}
