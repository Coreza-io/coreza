import type { EquityPoint } from "../backtest/simBroker/interfaces";

export interface DailyEquityPoint extends EquityPoint {
  equity_open: number;
  equity_high: number;
  equity_low: number;
  equity_close: number;
  equity_sample_count: number;
}

/** Finalization only: preserve observed equity extrema before daily reduction. */
export function aggregateDailyEquity(curve: readonly EquityPoint[]): DailyEquityPoint[] {
  const samples = curve.map((point, index) => ({ point, index, ts: Date.parse(point.timestamp) }));
  for (const { point, ts } of samples) {
    if (!Number.isFinite(ts) || !Number.isFinite(point.totalEquity)) throw new Error("Invalid observed backtest equity");
  }
  samples.sort((a, b) => a.ts - b.ts || a.index - b.index);
  const days: DailyEquityPoint[] = [];
  for (let index = 0; index < samples.length; index++) {
    const { point, ts } = samples[index];
    // Simultaneous valuations have no invented chronology: last recorded wins.
    if (index + 1 < samples.length && samples[index + 1].ts === ts) continue;
    const timestamp = new Date(ts).toISOString();
    const previous = days[days.length - 1];
    if (previous?.timestamp.substring(0, 10) === timestamp.substring(0, 10)) {
      const high = Math.max(previous.equity_high, point.totalEquity);
      const low = Math.min(previous.equity_low, point.totalEquity);
      Object.assign(previous, point, { timestamp, equity_high: high, equity_low: low,
        equity_close: point.totalEquity, equity_sample_count: previous.equity_sample_count + 1 });
    } else days.push({ ...point, timestamp, equity_open: point.totalEquity, equity_high: point.totalEquity,
      equity_low: point.totalEquity, equity_close: point.totalEquity, equity_sample_count: 1 });
  }
  return days;
}
