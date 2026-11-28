import {
  historicalBarTimestamp,
  type HistoricalBar,
} from "../../marketData/HistoricalDataService";
import type { MultiBarEvent } from "../session/BacktestSession";

export interface AlignedMultiBarEvent extends MultiBarEvent {
  fillForwardSymbols: string[];
}

type AlignableBar = HistoricalBar & {
  _sourceTimestamp?: number;
  _isFillForward?: boolean;
  time?: number;
};

/** Aligns symbols on the union of timestamps with causal fill-forward bars. */
export function alignMultiSymbolBars<T extends AlignableBar>(
  symbols: string[],
  barsBySymbol: ReadonlyMap<string, readonly T[]>,
  interval: string,
  eventTime: (bar: T) => number = historicalBarTimestamp,
  strategyStart = -Infinity,
): AlignedMultiBarEvent[] {
  const eventBars = new Map<number, T>();
  for (const bars of barsBySymbol.values()) {
    for (const bar of bars) {
      const timestamp = eventTime(bar);
      const existing = eventBars.get(timestamp);
      if (!existing || (bar.closeTime === timestamp && existing.closeTime !== timestamp)) {
        eventBars.set(timestamp, bar);
      }
    }
  }
  const orderedTimestamps = [...eventBars.keys()].filter(Number.isFinite).sort((a, b) => a - b);
  const warmupCount = orderedTimestamps.findIndex((timestamp) => timestamp >= strategyStart);
  const strategyOffset = warmupCount < 0 ? orderedTimestamps.length : warmupCount;
  const indexes = new Map(symbols.map((symbol) => [symbol, 0]));
  const previousBars = new Map<string, T>();
  return orderedTimestamps.map((timestamp, index) => {
    const isWarmingUp = timestamp < strategyStart;
    const bars: Record<string, T> = {};
    const activeSymbols: string[] = [];
    const fillForwardSymbols: string[] = [];
    for (const symbol of symbols) {
      const source = barsBySymbol.get(symbol) ?? [];
      const barIndex = indexes.get(symbol) ?? 0;
      const bar = source[barIndex];
      if (bar && eventTime(bar) === timestamp) {
        bars[symbol] = {
          ...bar,
          time: historicalBarTimestamp(bar),
          _sourceTimestamp: timestamp,
          _isFillForward: false,
        };
        previousBars.set(symbol, bars[symbol]);
        indexes.set(symbol, barIndex + 1);
        activeSymbols.push(symbol);
        continue;
      }
      const previous = previousBars.get(symbol);
      if (!isWarmingUp && previous && (previous._sourceTimestamp ?? -Infinity) >= strategyStart) {
        const eventBar = eventBars.get(timestamp)!;
        const useEventStart = eventBar.closeTime === timestamp ||
          (previous.closeTime !== undefined && previous.closeTime === previous._sourceTimestamp);
        bars[symbol] = {
          ...previous,
          time: useEventStart
            ? historicalBarTimestamp(eventBar)
            : timestamp - ((previous._sourceTimestamp ?? timestamp) - historicalBarTimestamp(previous)),
          ...(previous.closeTime !== undefined || eventBar.closeTime === timestamp ? { closeTime: timestamp } : {}),
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
      barIndex: index - strategyOffset,
      isWarmingUp,
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
