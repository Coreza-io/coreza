import { Bar } from '../types';
import type { MarketEvent } from '../../types/marketEvent';

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
