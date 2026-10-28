import type { PortfolioSnapshot } from "@/hooks/useBacktestResults";
import type { EquityCandle, EquityChartContext, EquityChartModel, EquityInterval, FixedEquityInterval } from "@/components/backtest/equityChartTypes";

export const EQUITY_INTERVALS: Record<FixedEquityInterval, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1D": 86_400_000,
};
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
export function orderedLiveEquitySnapshots<T extends { id: string; snapshot_at: string; equity?: unknown; total_value_usdt?: unknown; cash?: unknown }>(rows: T[]): T[] {
  const valid = rows.map((row, index) => ({ row, index, ts: parseEquityTimestamp(row.snapshot_at) }))
    .filter(({ row, ts }) => Number.isFinite(ts) &&
      (finiteEquityNumber(row.equity) ?? finiteEquityNumber(row.total_value_usdt) ?? finiteEquityNumber(row.cash)) !== null);
  valid.sort((a, b) => a.ts - b.ts || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : a.index - b.index));
  return valid.filter((sample, index) => index === valid.length - 1 || sample.ts !== valid[index + 1].ts)
    .map(sample => ({ ...sample.row, snapshot_at: new Date(sample.ts).toISOString() }));
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
  rows: PortfolioSnapshot[], context: EquityChartContext, requestedInterval: EquityInterval = "auto", now = Date.now(),
): EquityChartModel {
  const diagnostics = { invalidRows: 0, duplicateRows: 0, foreignRows: 0 };
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
    if (context.mode === "backtest") {
      if (!hasEquityOhlc(row)) incompleteOhlc = true;
      else completeOhlcRows++;
    }
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
  let interval: FixedEquityInterval = context.mode === "backtest" ? "1D" : requestedInterval === "auto" ? "1D" : requestedInterval;
  if (context.mode === "live" && requestedInterval === "auto") {
    for (const candidate of Object.keys(EQUITY_INTERVALS) as FixedEquityInterval[]) {
      const buckets = new Set<number>();
      for (const sample of unique) {
        buckets.add(Math.floor(sample.ts / EQUITY_INTERVALS[candidate]));
        if (buckets.size > 1000) break;
      }
      if (buckets.size <= 1000) { interval = candidate; break; }
    }
  }
  if (context.mode === "backtest" && (incompleteOhlc || diagnostics.invalidRows || diagnostics.foreignRows)) {
    const unavailableReason = completeOhlcRows > 0 ? "Candle data has incomplete OHLC coverage for this backtest. Run it again to capture every day." : LEGACY_CANDLE_MESSAGE;
    return { candles: [], interval, candleAvailable: false, unavailableReason, diagnostics };
  }
  const size = EQUITY_INTERVALS[interval];
  const candles: EquityCandle[] = [];
  for (const { row, ts, equity } of unique) {
    const startMs = Math.floor(ts / size) * size;
    const saved = context.mode === "backtest";
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
      previous.lastObservedMs = saved ? null : ts;
      previous.quality = previous.sampleCount === 1 ? "sparse" : "observed";
    } else candles.push({
      startMs, endMs: startMs + size, open, high, low, close, sampleCount: count,
      firstObservedMs: saved ? null : ts, lastObservedMs: saved ? null : ts,
      returnPct: null, isProvisional: false, quality: count === 1 ? "sparse" : "observed", returnSpansGap: false,
    });
  }
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index];
    const baseline = index ? candles[index - 1].close : finiteEquityNumber(context.initialCapital);
    const result = baseline !== null && baseline > 0 ? 100 * (candle.close / baseline - 1) : null;
    candle.returnPct = result !== null && Number.isFinite(result) ? result : null;
    candle.returnSpansGap = index > 0 && candles[index - 1].endMs < candle.startMs;
    candle.isProvisional = context.mode === "live" && context.active && index === candles.length - 1 && now >= candle.startMs && now < candle.endMs;
  }
  return { candles, interval, candleAvailable: true, diagnostics };
}
