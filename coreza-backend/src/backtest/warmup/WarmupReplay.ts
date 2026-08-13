import {
  historicalBarTimestamp,
  type HistoricalBar,
} from "../../marketData/HistoricalDataService";
import type { MultiBarEvent } from "../session/BacktestSession";

export interface AlignedMultiBarEvent extends MultiBarEvent {
  fillForwardSymbols: string[];
}

/** Aligns symbols on the union of timestamps with causal fill-forward bars. */
export function alignMultiSymbolBars<T extends HistoricalBar>(
  symbols: string[],
  barsBySymbol: ReadonlyMap<string, readonly T[]>,
  interval: string,
): AlignedMultiBarEvent[] {
  const timestamps = new Set<number>();
  for (const bars of barsBySymbol.values()) {
    for (const bar of bars) timestamps.add(historicalBarTimestamp(bar));
  }
  const indexes = new Map(symbols.map((symbol) => [symbol, 0]));
  const previousBars = new Map<string, T>();
  return [...timestamps]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
    .map((timestamp, barIndex) => {
      const bars: Record<string, T> = {};
      const activeSymbols: string[] = [];
      const fillForwardSymbols: string[] = [];
      for (const symbol of symbols) {
        const source = barsBySymbol.get(symbol) ?? [];
        const index = indexes.get(symbol) ?? 0;
        if (historicalBarTimestamp(source[index] ?? {}) === timestamp) {
          bars[symbol] = {
            ...source[index],
            time: timestamp,
            _sourceTimestamp: timestamp,
            _isFillForward: false,
          };
          previousBars.set(symbol, bars[symbol]);
          indexes.set(symbol, index + 1);
          activeSymbols.push(symbol);
          continue;
        }
        const previous = previousBars.get(symbol);
        if (previous) {
          bars[symbol] = {
            ...previous,
            time: timestamp,
            _sourceTimestamp:
              previous._sourceTimestamp ?? historicalBarTimestamp(previous),
            _isFillForward: true,
          };
          activeSymbols.push(symbol);
          fillForwardSymbols.push(symbol);
        }
      }
      return {
        timestamp: new Date(timestamp).toISOString(),
        barIndex,
        interval,
        symbols: activeSymbols,
        bars,
        fillForwardSymbols,
      };
    });
}

export function buildWarmupEvents(
  warmupBarsBySymbol: ReadonlyMap<string, readonly HistoricalBar[]>,
  interval: string,
): MultiBarEvent[] {
  return alignMultiSymbolBars(
    [...warmupBarsBySymbol.keys()],
    warmupBarsBySymbol,
    interval,
  );
}
