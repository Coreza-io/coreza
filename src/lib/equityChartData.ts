import type { PortfolioSnapshot } from "@/hooks/useBacktestResults";
import type { EquityCandle, EquityChartContext, EquityChartModel, EquityInterval, FixedEquityInterval } from "@/components/backtest/equityChartTypes";

export const EQUITY_INTERVALS: Record<Exclude<FixedEquityInterval, "1W" | "1M">, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1D": 86_400_000,
};
const LIVE_INTERVALS = ["1m", "5m", "15m", "1h", "1D"] as const;

/** UTC calendar months and Monday-start weeks; no synthetic observations. */
function bucketBounds(ts: number, interval: FixedEquityInterval): [number, number] {
  if (interval === "1M") {
    const date = new Date(ts);
    return [Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)];
  }
  if (interval === "1W") {
    const week = 7 * 86_400_000;
    const offset = 3 * 86_400_000; // Epoch Thursday -> Monday boundary.
    const start = Math.floor((ts + offset) / week) * week - offset;
    return [start, start + week];
  }
  const size = EQUITY_INTERVALS[interval];
  const start = Math.floor(ts / size) * size;
  return [start, start + size];
}
export const LEGACY_CANDLE_MESSAGE = "Candle data is unavailable for this older backtest. Run it again to capture equity OHLC.";

export function finiteEquityNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseEquityTimestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return NaN;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return NaN;
  // Date-only rows and timestamp strings without an offset have explicit UTC semantics.
  const timestamp = value.length > 10 && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? `${value}Z` : value;
  return Date.parse(timestamp);
}

/** Keep raw rows aligned with the shared normalization's timestamp order. */
export function orderedLiveEquitySnapshots<T extends { id: string; snapshot_at: string; equity?: unknown; total_value_usdt?: unknown; cash?: unknown }>(rows: T[]): { snapshots: T[]; diagnostics: { invalidRows: number; duplicateRows: number } } {
  const valid = rows.map((row, index) => ({ row, index, ts: parseEquityTimestamp(row.snapshot_at) }))
    .filter(({ row, ts }) => Number.isFinite(ts) &&
      (finiteEquityNumber(row.equity) ?? finiteEquityNumber(row.total_value_usdt) ?? finiteEquityNumber(row.cash)) !== null);
  valid.sort((a, b) => a.ts - b.ts || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : a.index - b.index));
  const snapshots = valid.filter((sample, index) => index === valid.length - 1 || sample.ts !== valid[index + 1].ts)
    .map(sample => ({ ...sample.row, snapshot_at: new Date(sample.ts).toISOString() }));
  return { snapshots, diagnostics: { invalidRows: rows.length - valid.length, duplicateRows: valid.length - snapshots.length } };
}

export function formatEquityReturn(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0.00%";
  const abs = Math.abs(value);
  if (abs < 0.000001) return `${value.toExponential(2)}%`;
  const digits = abs >= 0.01 ? 2 : Math.min(6, Math.ceil(-Math.log10(abs)) + 1);
  return `${value.toFixed(digits)}%`;
}

function sourceKey(row: PortfolioSnapshot): string {
  return JSON.stringify([row.live_strategy_id, row.broker ?? null, row.credential_id ?? null, row.base_currency ?? null]);
}

export function hasEquityOhlc(row: PortfolioSnapshot): boolean {
  const values = [row.equity_open, row.equity_high, row.equity_low, row.equity_close].map(finiteEquityNumber);
  if (values.some(value => value === null)) return false;
  const [open, high, low, close] = values as number[];
  return Number.isInteger(row.equity_sample_count) && row.equity_sample_count! > 0 &&
    high >= Math.max(open, close) && low <= Math.min(open, close) && high >= low && close === finiteEquityNumber(row.total_value);
}

/** Pure adapter: source-selected, normalized live equity enters here exactly once. */
export function buildEquityChartData(
  rows: PortfolioSnapshot[], context: EquityChartContext, requestedInterval: EquityInterval = "auto", now = Date.now(), allowCloseOnlyLine = false,
): EquityChartModel {
  const diagnostics = { invalidRows: context.inputDiagnostics?.invalidRows ?? 0, duplicateRows: context.inputDiagnostics?.duplicateRows ?? 0, foreignRows: 0 };
  const source = rows[0] ? sourceKey(rows[0]) : null;
  const samples: { row: PortfolioSnapshot; ts: number; equity: number; index: number }[] = [];
  let incompleteOhlc = false;
  let completeOhlcRows = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (sourceKey(row) !== source) { diagnostics.foreignRows++; continue; }
    const ts = parseEquityTimestamp(row.date);
    const equity = finiteEquityNumber(row.total_value);
    if (!Number.isFinite(ts) || equity === null) { diagnostics.invalidRows++; continue; }
    samples.push({ row, ts, equity, index });
  }
  samples.sort((a, b) => a.ts - b.ts || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : a.index - b.index));
  const unique: typeof samples = [];
  for (const sample of samples) {
    if (unique.length && unique[unique.length - 1].ts === sample.ts) {
      diagnostics.duplicateRows++;
      unique[unique.length - 1] = sample;
    } else unique.push(sample);
  }
  // Capability follows the winning same-instant row, not an obsolete duplicate.
  if (context.mode === "backtest") {
    for (const { row } of unique) {
      if (!hasEquityOhlc(row)) incompleteOhlc = true;
      else completeOhlcRows++;
    }
  }
  let interval: FixedEquityInterval = requestedInterval === "auto" ? "1D" : requestedInterval;
  if (context.mode === "backtest") {
    // Saved backtests have daily resolution; never offer fictitious intraday buckets.
    if (interval !== "1D" && interval !== "1W" && interval !== "1M") interval = "1D";
    if (requestedInterval === "auto" && unique.length > 1 && unique.every(({ row }) => row.equity_sample_count === 1)) {
      for (const candidate of ["1W", "1M"] as const) {
        const counts = new Map<number, number>();
        let hasMultiple = false;
        for (const sample of unique) {
          const start = bucketBounds(sample.ts, candidate)[0];
          const count = (counts.get(start) ?? 0) + 1;
          counts.set(start, count);
          if (count > 1) hasMultiple = true;
        }
        if (hasMultiple) { interval = candidate; break; }
      }
    }
  }
  if (context.mode === "live" && requestedInterval === "auto") {
    for (const candidate of LIVE_INTERVALS) {
      const buckets = new Set<number>();
      for (const sample of unique) {
        buckets.add(Math.floor(sample.ts / EQUITY_INTERVALS[candidate]));
        if (buckets.size > 1000) break;
      }
      if (buckets.size <= 1000) { interval = candidate; break; }
    }
  }
  const closeOnly = context.mode === "backtest" && !!(incompleteOhlc || diagnostics.invalidRows || diagnostics.foreignRows);
  const unavailableReason = closeOnly ? completeOhlcRows > 0 ? "Candle data has incomplete OHLC coverage for this backtest. Run it again to capture every day." : LEGACY_CANDLE_MESSAGE : undefined;
  if (closeOnly && !allowCloseOnlyLine) return { candles: [], interval, candleAvailable: false, unavailableReason, diagnostics };
  const candles: EquityCandle[] = [];
  for (const { row, ts, equity } of unique) {
    const [startMs, endMs] = bucketBounds(ts, interval);
    // Close-only observations are for Line mode only; Candle stays unavailable.
    const saved = context.mode === "backtest" && !closeOnly;
    const open = saved ? Number(row.equity_open) : equity;
    const high = saved ? Number(row.equity_high) : equity;
    const low = saved ? Number(row.equity_low) : equity;
    const close = saved ? Number(row.equity_close) : equity;
    const count = saved ? row.equity_sample_count! : 1;
    const previous = candles[candles.length - 1];
    if (previous?.startMs === startMs) {
      previous.high = Math.max(previous.high, high);
      previous.low = Math.min(previous.low, low);
      previous.close = close;
      previous.sampleCount += count;
      previous.lastObservedMs = context.mode === "backtest" ? null : ts;
      previous.quality = previous.sampleCount === 1 ? "sparse" : "observed";
    } else candles.push({
      startMs, endMs, open, high, low, close, sampleCount: count,
      firstObservedMs: context.mode === "backtest" ? null : ts, lastObservedMs: context.mode === "backtest" ? null : ts,
      returnPct: null, returnBaseline: null, isProvisional: false, quality: count === 1 ? "sparse" : "observed", returnSpansGap: false,
    });
  }
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const baseline = index ? candles[index - 1].close : finiteEquityNumber(context.initialCapital);
    const result = baseline !== null && baseline > 0 ? 100 * (candle.close / baseline - 1) : null;
    candle.returnPct = result !== null && Number.isFinite(result) ? result : null;
    candle.returnBaseline = candle.returnPct !== null ? baseline : null;
    candle.returnSpansGap = index > 0 && candles[index - 1].endMs < candle.startMs;
    candle.isProvisional = context.mode === "live" && context.active && index === candles.length - 1 && now >= candle.startMs && now < candle.endMs;
  }
  // Filter only after computing returns from the complete observation history.
  // Flat live buckets must not enter the chart, histogram, tooltip lookup or table.
  const visibleCandles: EquityCandle[] = [];
  let spansGap = false;
  for (const candle of candles) {
    spansGap ||= candle.returnSpansGap;
    if (context.mode === "live" && candle.returnBaseline !== null
      && candle.returnBaseline === candle.close
      && candle.high === candle.close && candle.low === candle.close) continue;
    visibleCandles.push({ ...candle, returnSpansGap: visibleCandles.length > 0 && spansGap });
    spansGap = false;
  }
  return { candles: visibleCandles, interval, candleAvailable: !closeOnly, unavailableReason, diagnostics };
}
