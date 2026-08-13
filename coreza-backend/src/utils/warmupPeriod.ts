/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export const DEFAULT_WARMUP_PERIOD = 200;

export function parseWarmupPeriod(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_WARMUP_PERIOD;
  }

  return Math.max(0, parseInt(String(raw), 10) || 0);
}
