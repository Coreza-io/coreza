/**
 * Canonical construction of MarketBarEnvelope from raw backtest bars.
 *
 * Every SimBroker.onBar() caller MUST go through this helper so that
 * source/event clocks and fill-forward provenance stay consistent.
 */
import { parseBar } from "../../utils/barParser";
import { MarketBarEnvelope } from "./interfaces";

function toEpochMs(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * @param rawBar aligned bar (may carry `_sourceTimestamp` / `_isFillForward`)
 * @param eventTimestamp the aligned backtest clock being processed
 */
export function toMarketBarEnvelope(
  symbol: string,
  rawBar: any,
  eventTimestamp?: string | number,
): MarketBarEnvelope | null {
  const bar = parseBar(rawBar);
  if (!bar) return null;

  const barTime = toEpochMs(rawBar?.time ?? rawBar?.timestamp ?? bar.timestamp);
  const eventTs =
    eventTimestamp !== undefined ? toEpochMs(eventTimestamp) : barTime;
  const sourceTs = toEpochMs(rawBar?._sourceTimestamp) || barTime;

  return {
    symbol,
    bar,
    sourceTimestamp: sourceTs,
    eventTimestamp: eventTs,
    isFillForward: rawBar?._isFillForward === true || sourceTs < eventTs,
  };
}
