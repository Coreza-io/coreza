import { isAxiosError } from 'axios';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Bar, BarSeriesOutput, BrokerOperationExecuteContext } from '../types';
import type { MarketEvent } from '../../types/marketEvent';

export const ALPACA_STOCK_TIMEZONE = 'America/New_York';

export function alpacaTradingBaseUrl(environment: unknown): string {
  return environment === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
}

function aggregatePartialBar(minutes: Bar[], time: number, closeTime: number): Bar | undefined {
  const byTime = new Map(minutes
    .filter(bar => bar.time >= time && bar.time < closeTime)
    .map(bar => [bar.time, bar]));
  const bars = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (!bars.length) return undefined;

  const volume = bars.reduce((sum, bar) => sum + bar.volume, 0);
  return {
    time,
    closeTime,
    open: bars[0].open,
    high: Math.max(...bars.map(bar => bar.high)),
    low: Math.min(...bars.map(bar => bar.low)),
    close: bars[bars.length - 1].close,
    volume,
    ...(bars.every(bar => Number.isFinite(bar.trades)) && {
      trades: bars.reduce((sum, bar) => sum + bar.trades!, 0),
    }),
    ...(volume > 0 && bars.every(bar => Number.isFinite(bar.vwap)) && {
      vwap: bars.reduce((sum, bar) => sum + bar.vwap! * bar.volume, 0) / volume,
    }),
  };
}

export async function filterAlpacaRegularHours(
  output: BarSeriesOutput,
  intervalMs: number,
  { input, headers, request }: BrokerOperationExecuteContext,
  fetchMinutes: (symbols: string[], start: number, end: number) => Promise<BarSeriesOutput>,
): Promise<BarSeriesOutput> {
  let first = Infinity;
  let last = -Infinity;
  for (const series of output.BarSeries) {
    for (const bar of series.bars) {
      first = Math.min(first, bar.time);
      last = Math.max(last, bar.time);
    }
  }

  // An opaque Alpaca cursor describes native bars. Only independently fill
  // missing boundary buckets when the response covers the whole request.
  const complete = !input.page_token && !output.has_more;
  const start = input.start ? Date.parse(input.start) : first;
  const end = Math.min(input.end ? Date.parse(input.end) : last + intervalMs, Date.now());
  const canReconstruct = intervalMs > 60_000;
  if (complete && canReconstruct && start < end) {
    first = Math.min(first, start);
    last = Math.max(last, end);
  }
  if (first === Infinity) return output;

  const sessionDate = (time: number) => formatInTimeZone(time, ALPACA_STOCK_TIMEZONE, 'yyyy-MM-dd');
  const params = { start: sessionDate(first), end: sessionDate(last) };
  const getCalendar = (environment: unknown) =>
    request.get<unknown>(`${alpacaTradingBaseUrl(environment)}/v2/calendar`, { params, headers, timeout: 30000 });
  const calendar = await getCalendar(input.environment).catch((error: unknown) => {
    if (!isAxiosError(error) || (error.response?.status !== 401 && error.response?.status !== 403)) throw error;
    // The data endpoint accepts both types of keys. The calendar uses a trading host.
    return getCalendar(input.environment === 'live' ? 'paper' : 'live');
  });

  if (!Array.isArray(calendar.data)) throw new Error('Invalid Alpaca trading calendar response');
  const sessions = new Map<string, { open: number; close: number }>();
  for (const day of calendar.data) {
    const open = fromZonedTime(`${day?.date}T${day?.open}:00`, ALPACA_STOCK_TIMEZONE).getTime();
    const close = fromZonedTime(`${day?.date}T${day?.close}:00`, ALPACA_STOCK_TIMEZONE).getTime();
    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) {
      throw new Error('Invalid Alpaca trading session');
    }
    sessions.set(day.date, { open, close });
  }

  const seriesBySymbol = new Map(output.BarSeries.map(series => [series.symbol, {
    ...series,
    bars: series.bars.filter(({ time }) => {
      const session = sessions.get(sessionDate(time));
      return !!session && time >= session.open && time + intervalMs <= session.close;
    }),
  }]));
  if (!canReconstruct) return { ...output, BarSeries: [...seriesBySymbol.values()] };

  const nativeStarts = new Map(output.BarSeries.map(series => [
    series.symbol, new Set(series.bars.map(bar => bar.time)),
  ]));
  const symbols = [...new Set<string>(input.symbol.split(','))];
  const sortDirection = input.sort === 'desc' ? -1 : 1;
  for (const { open, close } of sessions.values()) {
    // Alpaca's supported intraday intervals divide an hour and use the
    // existing clock grid. Only the opening and closing buckets can overlap.
    const buckets = new Set([Math.floor(open / intervalMs) * intervalMs, Math.floor((close - 1) / intervalMs) * intervalMs]);
    for (const bucket of buckets) {
      const time = Math.max(open, bucket);
      const closeTime = Math.min(close, bucket + intervalMs);
      if (time === bucket && closeTime === bucket + intervalMs) continue;
      if ((input.start && time < start) || closeTime > end) continue;
      const eligible = complete && time >= start
        ? symbols
        : symbols.filter(symbol => nativeStarts.get(symbol)?.has(bucket));
      if (!eligible.length) continue;

      const minutes = await fetchMinutes(eligible, time, closeTime);
      for (const series of minutes.BarSeries) {
        if (!eligible.includes(series.symbol)) continue;
        const partial = aggregatePartialBar(series.bars, time, closeTime);
        if (!partial) continue;
        const target = seriesBySymbol.get(series.symbol) ?? { symbol: series.symbol, interval: input.interval, bars: [] };
        target.bars.push(partial);
        seriesBySymbol.set(series.symbol, target);
      }
    }
  }

  for (const series of seriesBySymbol.values()) {
    series.bars.sort((a, b) => sortDirection * (a.time - b.time));
  }
  return { ...output, BarSeries: [...seriesBySymbol.values()] };
}

export function buildAlpacaAuthMessage(creds: any) {
  return {
    action: 'auth',
    key: creds.api_key,
    secret: creds.secret_key,
  };
}

export function buildAlpacaSubscribeMessage(symbols: string[], types: string[] = ['trades']) {
  const msg: any = { action: 'subscribe' };
  types.forEach((t) => {
    msg[t] = symbols;
  });
  return msg;
}

export function buildAlpacaUnsubscribeMessage(symbols: string[], types: string[] = ['trades']) {
  const msg: any = { action: 'unsubscribe' };
  types.forEach((t) => {
    msg[t] = symbols;
  });
  return msg;
}

export function parseAlpacaMessage(buffer: Buffer): any[] {
  return JSON.parse(buffer.toString());
}

export function identifyAlpacaMessageType(msg: any): string {
  return msg.T;
}

export function shouldPublishAlpacaMessage(msg: any): boolean {
  return ['t', 'q', 'b', 'd'].includes(msg.T);
}

export function normalizeAlpacaMessage(msg: any): MarketEvent | null {
  const symbol = msg.S?.toUpperCase();
  const t = msg.t ? new Date(msg.t).getTime() : Date.now();

  switch (msg.T) {
    case 't':
      return {
        source: 'alpaca' as const,
        symbol,
        t,
        type: 'trade' as const,
        p: msg.p,
        q: msg.s,
        x: msg.x,
      };
    case 'q':
      return {
        source: 'alpaca' as const,
        symbol,
        t,
        type: 'quote' as const,
        b: msg.bp,
        B: msg.bs,
        a: msg.ap,
        A: msg.as,
      };
    case 'b':
      return {
        source: 'alpaca' as const,
        symbol,
        t,
        type: 'bar' as const,
        o: msg.o,
        h: msg.h,
        l: msg.l,
        c: msg.c,
        v: msg.v,
        vw: msg.vw,
        timeframe: '1m',
      };
    case 'd':
      return {
        source: 'alpaca' as const,
        symbol,
        t,
        type: 'daily_bar' as const,
        o: msg.o,
        h: msg.h,
        l: msg.l,
        c: msg.c,
        v: msg.v,
        timeframe: '1d',
      };
    default:
      return null;
  }
}


export interface AlpacaBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
  vwap: number;
}

export function parseAlpacaRawBar(x: any): AlpacaBar {
  return {
    time: Date.parse(x.t),
    open: x.o,
    high: x.h,
    low: x.l,
    close: x.c,
    volume: x.v,
    trades: x.n,
    vwap: x.vw,
  };
}

export function fromAlpacaBar(b: AlpacaBar): Bar {
  return {
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    trades: b.trades,
    vwap: b.vwap,
  };
}
