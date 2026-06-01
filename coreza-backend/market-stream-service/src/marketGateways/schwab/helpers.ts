import type { CorezaMarketEvent } from '../../types/marketEvent';
import type { GatewayPreConnectContext } from '../types';
import {
  OAuthRefreshProviderConfig,
  refreshOAuthTokenIfNeeded,
} from '../../utils/oauthTokenManager';
import {
  buildSchwabLoginMessage,
  fetchSchwabStreamingConfig,
  parseSchwabStreamingMessage,
} from '../../utils/schwabStreamingSetup';

type SchwabAssetType = 'equity' | 'future';
type SchwabStreamType = 'quote' | 'chart';
type SchwabService =
  | 'LEVELONE_EQUITIES'
  | 'LEVELONE_FUTURES'
  | 'CHART_EQUITY'
  | 'CHART_FUTURES';

const DEFAULT_ASSET_TYPE: SchwabAssetType = 'equity';

const SCHWAB_SERVICE_MAP: Record<
  SchwabAssetType,
  Partial<Record<SchwabStreamType, SchwabService>>
> = {
  equity: {
    quote: 'LEVELONE_EQUITIES',
    chart: 'CHART_EQUITY',
  },
  future: {
    quote: 'LEVELONE_FUTURES',
    chart: 'CHART_FUTURES',
  },
};

const SCHWAB_SERVICE_REVERSE: Record<SchwabService, SchwabStreamType> = {
  LEVELONE_EQUITIES: 'quote',
  LEVELONE_FUTURES: 'quote',
  CHART_EQUITY: 'chart',
  CHART_FUTURES: 'chart',
};

const SCHWAB_SERVICE_FIELDS: Record<SchwabService, string> = {
  LEVELONE_EQUITIES: '0,1,2,3,4,5,8,10,11,12,17,34,35',
  LEVELONE_FUTURES: '0,1,2,3,4,5,8,10,11,12,13,14,18',
  CHART_EQUITY: '0,1,2,3,4,5,6,7,8',
  CHART_FUTURES: '0,1,2,3,4,5,6,7,8',
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toSymbol(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : '';
}

function parseSchwabAssetType(source?: string): SchwabAssetType {
  const rawAsset = String(source || '').split('_')[1]?.toLowerCase();
  return rawAsset === 'future' ? 'future' : DEFAULT_ASSET_TYPE;
}

function parseSchwabStreamName(streamName: string): {
  symbol: string;
  streamType: SchwabStreamType;
} {
  const [rawSymbol, rawStreamType = 'quote'] = streamName.split('@');
  const normalizedStreamType = rawStreamType.split('_')[0] as SchwabStreamType;

  if (normalizedStreamType !== 'quote' && normalizedStreamType !== 'chart') {
    throw new Error(`Unsupported Schwab stream type: ${rawStreamType}`);
  }

  return {
    symbol: rawSymbol.toUpperCase(),
    streamType: normalizedStreamType,
  };
}

function resolveSchwabService(
  streamType: SchwabStreamType,
  assetType: SchwabAssetType,
): SchwabService {
  const service = SCHWAB_SERVICE_MAP[assetType][streamType];
  if (!service) {
    throw new Error(
      `Unsupported Schwab stream combination: ${assetType}/${streamType}`,
    );
  }
  return service;
}

function buildSchwabRequest(
  streamNames: string[],
  command: 'SUBS' | 'UNSUBS',
  source?: string,
) {
  const assetType = parseSchwabAssetType(source);
  const symbolsByService = new Map<SchwabService, Set<string>>();

  for (const streamName of streamNames) {
    const { symbol, streamType } = parseSchwabStreamName(streamName);
    const service = resolveSchwabService(streamType, assetType);
    if (!symbolsByService.has(service)) {
      symbolsByService.set(service, new Set());
    }
    symbolsByService.get(service)!.add(symbol);
  }

  const requests = Array.from(symbolsByService.entries()).map(
    ([service, symbols], index) => {
      const keys = Array.from(symbols).join(',');
      console.log(
        `[Schwab Streaming] ${command} resolved ${assetType}/${SCHWAB_SERVICE_REVERSE[service]} to ${service}: ${keys}`,
      );

      return {
        requestid: String(Date.now() + index),
        service,
        command,
        parameters: {
          keys,
          ...(command === 'SUBS'
            ? { fields: SCHWAB_SERVICE_FIELDS[service] }
            : {}),
        },
      };
    },
  );

  return { requests };
}

function flattenSchwabContentMessages(messages: any[]): any[] {
  const flattened: any[] = [];

  for (const message of messages) {
    if (Array.isArray(message?.content) && message.content.length > 1) {
      for (const content of message.content) {
        flattened.push({ ...message, content: [content] });
      }
      continue;
    }

    flattened.push(message);
  }

  return flattened;
}

export async function preConnectSchwab(
  creds: any,
  context: GatewayPreConnectContext,
  oauthRefreshConfig: OAuthRefreshProviderConfig,
) {
  const readyCreds = await refreshOAuthTokenIfNeeded(
    creds,
    context.userId,
    context.credentialId,
    oauthRefreshConfig,
  );

  if (!readyCreds.access_token) {
    throw new Error(
      'Schwab access token is missing after refresh readiness check',
    );
  }

  return fetchSchwabStreamingConfig(readyCreds.access_token);
}

export function buildSchwabAuthMessage(creds: any) {
  return buildSchwabLoginMessage(creds);
}

export function buildSchwabSubscribeMessage(
  streamNames: string[],
  source?: string,
) {
  return buildSchwabRequest(streamNames, 'SUBS', source);
}

export function buildSchwabUnsubscribeMessage(
  streamNames: string[],
  source?: string,
) {
  return buildSchwabRequest(streamNames, 'UNSUBS', source);
}

export function parseSchwabMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return flattenSchwabContentMessages(parseSchwabStreamingMessage(parsed));
}

export function identifySchwabMessageType(msg: any): string {
  return (
    SCHWAB_SERVICE_REVERSE[msg.service as SchwabService] ||
    msg.service ||
    'unknown'
  );
}

export function shouldPublishSchwabMessage(msg: any): boolean {
  return Boolean(
    SCHWAB_SERVICE_REVERSE[msg.service as SchwabService] &&
      msg.content?.length > 0,
  );
}

function normalizeSchwabQuoteMessage(
  msg: any,
  service: SchwabService,
): CorezaMarketEvent | null {
  const content = msg.content?.[0];
  if (!content) return null;

  const isFuture = service === 'LEVELONE_FUTURES';

  return {
    source: 'schwab',
    symbol: toSymbol(content.key || content['0']),
    type: 'quote',
    t:
      toNumber(content[isFuture ? '11' : '35']) ??
      toNumber(content[isFuture ? '10' : '34']) ??
      Date.now(),
    p: toNumber(content['3']),
    b: toNumber(content['1']),
    B: toNumber(content['4']),
    a: toNumber(content['2']),
    A: toNumber(content['5']),
    o: toNumber(content[isFuture ? '18' : '17']),
    h: toNumber(content[isFuture ? '12' : '10']),
    l: toNumber(content[isFuture ? '13' : '11']),
    c: toNumber(content[isFuture ? '14' : '12']),
    v: toNumber(content['8']),
  };
}

function normalizeSchwabChartMessage(msg: any): CorezaMarketEvent | null {
  const content = msg.content?.[0];
  if (!content) return null;

  return {
    source: 'schwab',
    symbol: toSymbol(content.key || content['0']),
    type: 'chart',
    t: toNumber(content['7']) ?? Date.now(),
    o: toNumber(content['1']),
    h: toNumber(content['2']),
    l: toNumber(content['3']),
    c: toNumber(content['4']),
    v: toNumber(content['5']),
  };
}

export function normalizeSchwabMessage(msg: any): CorezaMarketEvent | null {
  const service = msg.service as SchwabService;
  const streamType = SCHWAB_SERVICE_REVERSE[service];

  if (streamType === 'quote') return normalizeSchwabQuoteMessage(msg, service);
  if (streamType === 'chart') return normalizeSchwabChartMessage(msg);

  return null;
}
