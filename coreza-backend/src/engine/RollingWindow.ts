/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export class RollingWindow<T> {
  private buffer: T[] = [];

  constructor(public readonly size: number) {
    if (size <= 0) throw new Error("RollingWindow size must be > 0");
    if (size > 500)
      throw new Error("RollingWindow size exceeds Coreza hard limit (500)");
  }

  add(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length > this.size) {
      this.buffer.shift();
    }
  }

  get isReady(): boolean {
    return this.buffer.length === this.size;
  }

  get count(): number {
    return this.buffer.length;
  }

  /** 0 = most recent, 1 = previous */
  at(offsetFromLatest: number): T {
    const index = this.buffer.length - 1 - offsetFromLatest;
    if (index < 0 || index >= this.buffer.length)
      throw new Error(
        `RollingWindow index out of bounds: offset ${offsetFromLatest}, count ${this.buffer.length}`,
      );

    return this.buffer[index];
  }

  values(): readonly T[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
