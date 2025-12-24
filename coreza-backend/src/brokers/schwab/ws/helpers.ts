import type { MarketEvent } from '../../../types/marketEvent';
import {
  buildSchwabLoginMessage,
  fetchSchwabStreamingConfig,
  parseSchwabStreamingMessage,
} from '../../utils/schwabStreamingSetup';

export async function preConnectSchwab(creds: any) {
  return fetchSchwabStreamingConfig(creds.access_token);
}

export function buildSchwabAuthMessage(creds: any) {
  return buildSchwabLoginMessage(creds);
}

export function buildSchwabSubscribeMessage(symbols: string[]) {
  return {
    requests: [
      {
        requestid: String(Date.now()),
        service: 'LEVELONE_EQUITIES',
        command: 'SUBS',
        parameters: {
          keys: symbols.join(','),
          fields: '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,28',
        },
      },
    ],
  };
}

export function buildSchwabUnsubscribeMessage(symbols: string[]) {
  return {
    requests: [
      {
        requestid: String(Date.now()),
        service: 'LEVELONE_EQUITIES',
        command: 'UNSUBS',
        parameters: {
          keys: symbols.join(','),
        },
      },
    ],
  };
}

export function parseSchwabMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return parseSchwabStreamingMessage(parsed);
}

export function identifySchwabMessageType(msg: any): string {
  if (msg.service === 'LEVELONE_EQUITIES') return 'quote';
  if (msg.service === 'CHART_EQUITY') return 'bar';
  return msg.service || 'unknown';
}

export function shouldPublishSchwabMessage(msg: any): boolean {
  return msg.service === 'LEVELONE_EQUITIES' && msg.content?.length > 0;
}

export function normalizeSchwabMessage(msg: any): MarketEvent | null {
  if (msg.service !== 'LEVELONE_EQUITIES') return null;

  const content = msg.content?.[0];
  if (!content) return null;

  return {
    source: 'schwab' as const,
    symbol: content.key?.toUpperCase() || content['0']?.toUpperCase(),
    type: 'quote' as const,
    t: Date.now(),
    p: content['3'],
    b: content['1'],
    B: content['4'],
    a: content['2'],
    A: content['5'],
    o: content['28'],
    h: content['12'],
    l: content['13'],
    c: content['15'],
    v: content['8'],
  };
}
