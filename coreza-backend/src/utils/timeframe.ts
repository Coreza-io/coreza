const UNIT_MILLISECONDS = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

export interface Timeframe {
  normalized: string;
  milliseconds: number;
}

export interface TimeframeRatio {
  source: Timeframe;
  target: Timeframe;
  ratio: number;
}

export function parseTimeframe(value: unknown): Timeframe {
  const input = String(value ?? "").trim().toLowerCase();
  const match = /^(\d+)\s*(m|min|h|d|day|w|week)$/.exec(input);
  if (!match) {
    throw new Error(`Invalid timeframe "${String(value ?? "")}". Use minute, hour, day, or week intervals (for example 5m or 4h).`);
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`Invalid timeframe amount: ${match[1]}`);
  }
  const aliases: Record<string, keyof typeof UNIT_MILLISECONDS> = {
    min: "m",
    day: "d",
    week: "w",
  };
  const unit = aliases[match[2]] ?? match[2] as keyof typeof UNIT_MILLISECONDS;
  return {
    normalized: `${amount}${unit}`,
    milliseconds: amount * UNIT_MILLISECONDS[unit],
  };
}

export function validateTimeframeRatio(sourceValue: unknown, targetValue: unknown): TimeframeRatio {
  const source = parseTimeframe(sourceValue);
  const target = parseTimeframe(targetValue);
  if (target.milliseconds < source.milliseconds || target.milliseconds % source.milliseconds !== 0) {
    throw new Error(`Target timeframe ${target.normalized} must be an exact multiple of source timeframe ${source.normalized}`);
  }
  return { source, target, ratio: target.milliseconds / source.milliseconds };
}
