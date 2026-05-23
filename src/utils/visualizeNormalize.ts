import type { CorezaCandle, SeriesPoint, UTCTimestamp } from "@/components/charts/chartTypes";

const OSCILLATOR_NAMES = ["rsi", "macd", "volume_oscillator", "pvo", "obv", "adx", "stoch"] as const;
const PALETTE = ["#3b82f6", "#8b5cf6", "#22c55e", "#ef4444", "#f59e0b", "#06b6d4"];

type Dict = Record<string, unknown>;
type OverlayKind = "line" | "bands" | "levels" | "panel";

export type OverlayClassification =
  | { kind: "line" }
  | { kind: "panel" }
  | { kind: "bands"; upper: unknown; middle?: unknown; lower: unknown }
  | { kind: "levels"; supports: number[]; resistances: number[]; supportSeries?: Array<{ time: UTCTimestamp; value: number }>; resistanceSeries?: Array<{ time: UTCTimestamp; value: number }>; pivot?: number | null; highestHigh?: number | null; lowestLow?: number | null; swingHighsCount?: number | null; swingLowsCount?: number | null };

const asDict = (value: unknown): Dict | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : null);
const toFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const isDateOnly = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
const parseDateOnlyToUtcSeconds = (value: string): UTCTimestamp | null => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000) as UTCTimestamp;
};

export const normalizeTime = (value: unknown): UTCTimestamp | null => {
  if (typeof value === "number") return (value >= 1e12 ? Math.floor(value / 1000) : Math.floor(value)) as UTCTimestamp;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      return (asNumber >= 1e12 ? Math.floor(asNumber / 1000) : Math.floor(asNumber)) as UTCTimestamp;
    }
    if (isDateOnly(trimmed)) return parseDateOnlyToUtcSeconds(trimmed);
    const milliseconds = Date.parse(trimmed);
    return Number.isNaN(milliseconds) ? null : (Math.floor(milliseconds / 1000) as UTCTimestamp);
  }
  return null;
};

const normalizeCandleRow = (row: Dict): CorezaCandle | null => {
  const time = normalizeTime(row.time ?? row.t ?? row.timestamp ?? row.datetime ?? row.date);
  const open = toFiniteNumber(row.open ?? row.o);
  const high = toFiniteNumber(row.high ?? row.h);
  const low = toFiniteNumber(row.low ?? row.l);
  const close = toFiniteNumber(row.close ?? row.c);
  const volumeRaw = row.volume ?? row.v;
  const volume = volumeRaw === undefined || volumeRaw === null ? undefined : toFiniteNumber(volumeRaw);

  if (time === null || open === null || high === null || low === null || close === null) return null;
  if (high < low) return null;
  if (volumeRaw !== undefined && volumeRaw !== null && volume === null) return null;

  return { time, open, high, low, close, volume: volume ?? undefined };
};

const finalizeCandles = (candles: CorezaCandle[]): CorezaCandle[] => {
  const byTime = new Map<UTCTimestamp, CorezaCandle>();
  candles.forEach((candle) => byTime.set(candle.time, candle));
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
};

export const extractBars = (input: unknown): CorezaCandle[] => {
  const root = asDict(input);
  const nestedData = asDict(root?.data);
  const barSeries = (nestedData?.BarSeries ?? root?.BarSeries) as unknown;
  const barsCandidate = (Array.isArray(barSeries) ? asDict(barSeries[0])?.bars : undefined) ?? root?.bars ?? root?.candles ?? nestedData?.bars ?? nestedData?.candles ?? input;

  if (Array.isArray(barsCandidate)) {
    return finalizeCandles(
      barsCandidate
        .map((row) => normalizeCandleRow(asDict(row) ?? {}))
        .filter((row): row is CorezaCandle => row !== null),
    );
  }

  const dict = asDict(barsCandidate);
  const times = dict ? (dict.time ?? dict.t) : undefined;
  if (!Array.isArray(times) || !dict) return [];

  return finalizeCandles(
    times
      .map((time, index) =>
        normalizeCandleRow({
          time,
          open: (dict.open as unknown[] | undefined)?.[index] ?? (dict.o as unknown[] | undefined)?.[index],
          high: (dict.high as unknown[] | undefined)?.[index] ?? (dict.h as unknown[] | undefined)?.[index],
          low: (dict.low as unknown[] | undefined)?.[index] ?? (dict.l as unknown[] | undefined)?.[index],
          close: (dict.close as unknown[] | undefined)?.[index] ?? (dict.c as unknown[] | undefined)?.[index],
          volume: (dict.volume as unknown[] | undefined)?.[index] ?? (dict.v as unknown[] | undefined)?.[index],
        }),
      )
      .filter((row): row is CorezaCandle => row !== null),
  );
};

const normalizeSeriesPoint = (value: unknown): { time: UTCTimestamp; value: number } | null => {
  const row = asDict(value);
  if (!row) return null;
  const time = normalizeTime(row.time ?? row.t ?? row.timestamp);
  const numeric = toFiniteNumber(row.value ?? row.v ?? row.level ?? row.close ?? row.c);
  if (time === null || numeric === null) return null;
  return { time, value: numeric };
};

export const alignSeriesToCandles = (candles: CorezaCandle[], raw: unknown): SeriesPoint[] => {
  if (candles.length === 0) return [];
  if (!Array.isArray(raw)) return candles.map((c) => ({ time: c.time, value: null }));

  const allNumeric = raw.every((value) => toFiniteNumber(value) !== null);
  if (allNumeric) {
    const numericSeries = raw.map((value) => toFiniteNumber(value)).filter((v): v is number => v !== null);
    const windowed = numericSeries.length > candles.length ? numericSeries.slice(numericSeries.length - candles.length) : numericSeries;
    const pad = Math.max(0, candles.length - windowed.length);
    return candles.map((c, i) => ({ time: c.time, value: i < pad ? null : windowed[i - pad] ?? null }));
  }

  const byTime = new Map<UTCTimestamp, number>();
  raw.forEach((item) => {
    const point = normalizeSeriesPoint(item);
    if (point) byTime.set(point.time, point.value);
  });
  return candles.map((c) => ({ time: c.time, value: byTime.get(c.time) ?? null }));
};

const parseLevelsArray = (entries: unknown[]) => {
  const supports: number[] = [];
  const resistances: number[] = [];
  const supportSeries: Array<{ time: UTCTimestamp; value: number }> = [];
  const resistanceSeries: Array<{ time: UTCTimestamp; value: number }> = [];

  entries.forEach((entry) => {
    const row = asDict(entry);
    if (!row) return;
    const level = toFiniteNumber(row.level ?? row.value ?? row.price);
    const time = normalizeTime(row.time ?? row.t ?? row.timestamp);
    const type = String(row.type ?? "").toLowerCase();
    if (level === null) return;
    if (type === "support") {
      supports.push(level);
      if (time !== null) supportSeries.push({ time, value: level });
    }
    if (type === "resistance") {
      resistances.push(level);
      if (time !== null) resistanceSeries.push({ time, value: level });
    }
  });

  return { supports, resistances, supportSeries: supportSeries.length ? supportSeries : undefined, resistanceSeries: resistanceSeries.length ? resistanceSeries : undefined };
};

const parseLevelsSummaryRow = (value: unknown): { supports: number[]; resistances: number[]; pivot?: number | null; highestHigh?: number | null; lowestLow?: number | null; swingHighsCount?: number | null; swingLowsCount?: number | null } | null => {
  const row = asDict(value);
  if (!row) return null;

  const supportsRaw = Array.isArray(row.support) ? row.support : Array.isArray(row.supports) ? row.supports : null;
  const resistancesRaw = Array.isArray(row.resistance) ? row.resistance : Array.isArray(row.resistances) ? row.resistances : null;
  if (!supportsRaw && !resistancesRaw) return null;

  const supports = (supportsRaw ?? []).map(toFiniteNumber).filter((level): level is number => level !== null);
  const resistances = (resistancesRaw ?? []).map(toFiniteNumber).filter((level): level is number => level !== null);
  const pivot = toFiniteNumber(row.pivot);
  const highestHigh = toFiniteNumber(row.highest_high ?? row.highestHigh);
  const lowestLow = toFiniteNumber(row.lowest_low ?? row.lowestLow);
  const swingHighsCount = toFiniteNumber(row.swing_highs_count ?? row.swingHighsCount);
  const swingLowsCount = toFiniteNumber(row.swing_lows_count ?? row.swingLowsCount);
  return { supports, resistances, pivot, highestHigh, lowestLow, swingHighsCount, swingLowsCount };
};

const hasNonOverlappingRange = (candles: CorezaCandle[], resolved: unknown): boolean => {
  const aligned = alignSeriesToCandles(candles, Array.isArray(resolved) ? resolved : asDict(resolved)?.values ?? asDict(resolved)?.data ?? []);
  const values = aligned.map((p) => p.value).filter((p): p is number => p !== null);
  if (!values.length || !candles.length) return false;
  const [minV, maxV] = [Math.min(...values), Math.max(...values)];
  const closes = candles.map((c) => c.close);
  const [minC, maxC] = [Math.min(...closes), Math.max(...closes)];
  return maxV < minC || minV > maxC;
};

const normalizeRenderKind = (render: string | undefined): OverlayKind | "auto" => {
  const normalized = render?.trim().toLowerCase();
  return normalized === "line" || normalized === "bands" || normalized === "levels" || normalized === "panel" ? normalized : "auto";
};

export const classifyOverlay = (name: string, render: string | undefined, resolved: unknown, candles: CorezaCandle[]): OverlayClassification => {
  const forced = normalizeRenderKind(render);
  const obj = asDict(resolved);
  const arr = Array.isArray(resolved) ? resolved : null;

  const bands = (() => {
    if (obj) {
      const present = [obj.upper, obj.middle, obj.lower].filter(Array.isArray).length;
      if (present >= 2 && Array.isArray(obj.upper) && Array.isArray(obj.lower)) {
        return { kind: "bands", upper: obj.upper, middle: obj.middle, lower: obj.lower } as OverlayClassification;
      }
    }
    if (arr?.length && asDict(arr[0]) && ((asDict(arr[0])?.upper !== undefined) || (asDict(arr[0])?.lower !== undefined))) {
      return { kind: "bands", upper: arr.map((row) => asDict(row)?.upper ?? null), middle: arr.map((row) => asDict(row)?.middle ?? null), lower: arr.map((row) => asDict(row)?.lower ?? null) } as OverlayClassification;
    }
    return null;
  })();

  const levels = (() => {
    if (obj) {
      const parsedSummary = parseLevelsSummaryRow(obj);
      if (parsedSummary && (parsedSummary.supports.length || parsedSummary.resistances.length)) return { kind: "levels", ...parsedSummary } as OverlayClassification;
    }
    if (arr?.length) {
      const parsedSummary = parseLevelsSummaryRow(arr[arr.length - 1]);
      if (parsedSummary && (parsedSummary.supports.length || parsedSummary.resistances.length)) return { kind: "levels", ...parsedSummary } as OverlayClassification;
      const parsed = parseLevelsArray(arr);
      if (parsed.supports.length || parsed.resistances.length) return { kind: "levels", ...parsed } as OverlayClassification;
    }
    return null;
  })();

  if (forced !== "auto") {
    if (forced === "bands" && bands) return bands;
    if (forced === "levels" && levels) return levels;
    return forced === "panel" ? { kind: "panel" } : { kind: "line" };
  }

  if (bands) return bands;
  if (levels) return levels;
  if (obj?.panel === true || obj?.pane === "panel") return { kind: "panel" };
  if (OSCILLATOR_NAMES.some((token) => name.toLowerCase().includes(token))) return { kind: "panel" };
  if (hasNonOverlappingRange(candles, resolved)) return { kind: "panel" };

  return { kind: "line" };
};

export const getPaletteColor = (index: number, fallback?: string): string => (fallback && fallback.trim() ? fallback : PALETTE[index % PALETTE.length]);
