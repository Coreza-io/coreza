import { dhanGatewayConfig } from '../src/marketGateways/dhan/config';
import {
  buildDhanSubscribeMessage,
  buildDhanUnsubscribeMessage,
  normalizeDhanMessage,
  parseDhanMessage,
  getDhanWsUrl,
} from '../src/marketGateways/dhan/helpers';
import { computeTradingNativeStreamsFromConfig, getBrokerStreamConfig } from '../src/config/brokerStreamConfig';
import { buildStreamNames } from '../src/utils/streamName';
import { SOURCE_MAPPING } from '../src/marketGateways';
import {
  getDhanMarketWsUrl,
  getDhanOrderUpdateWsUrl,
  getDhanRestBaseUrl,
  resolveDhanEnvironment,
} from '../src/marketGateways/dhan/environment';

describe('Dhan order-update stream', () => {
  it('builds LoginReq auth and does not send subscribe payloads for dhan_trading', () => {
    const creds = { client_id: 'client-1', api_key: 'token-1' };

    expect(resolveDhanEnvironment({})).toBe('live');
    expect(resolveDhanEnvironment({ environment: 'sandbox' })).toBe('sandbox');
    expect(resolveDhanEnvironment({ environment: 'unknown' })).toBe('live');
    expect(getDhanRestBaseUrl('live')).toBe('https://api.dhan.co/v2');
    expect(getDhanRestBaseUrl('sandbox')).toBe('https://sandbox.dhan.co/v2');
    expect(getDhanMarketWsUrl('live')).toBe('wss://api-feed.dhan.co');
    expect(getDhanOrderUpdateWsUrl('live')).toBe('wss://api-order-update.dhan.co');
    expect(getDhanMarketWsUrl('sandbox')).toBe('wss://api-feed.dhan.co');
    expect(getDhanOrderUpdateWsUrl('sandbox')).toBe('wss://sandbox-api-order-update.dhan.co');
    expect(typeof dhanGatewayConfig.wsUrl === 'function' ? dhanGatewayConfig.wsUrl(creds, 'dhan_trading') : '').toBe(
      'wss://api-order-update.dhan.co',
    );
    expect(
      typeof dhanGatewayConfig.wsUrl === 'function'
        ? dhanGatewayConfig.wsUrl({ ...creds, environment: 'sandbox' }, 'dhan')
        : '',
    ).toBe('wss://api-feed.dhan.co?version=2&token=token-1&clientId=client-1&authType=2');
    expect(dhanGatewayConfig.makeAuthMessage?.(creds, 'dhan_trading')).toEqual({
      LoginReq: {
        MsgCode: 42,
        ClientId: 'client-1',
        Token: 'token-1',
      },
      UserType: 'SELF',
    });
    expect(dhanGatewayConfig.makeSubscribeMessage(['order_alert'], 'dhan_trading')).toBeNull();
    expect(buildDhanSubscribeMessage(['order_alert'], 'dhan_trading')).toBeNull();
  });

  it('drives Dhan stream metadata, routing keys, and auth redaction from broker config', () => {
    const marketConfig = getBrokerStreamConfig('dhan_stream');
    const tradingConfig = getBrokerStreamConfig('dhan_trading');
    const authMessage = {
      LoginReq: {
        MsgCode: 42,
        ClientId: 'client-1',
        Token: 'token-1',
      },
      UserType: 'SELF',
    };

    // Preprocess seeds the symbol<->securityId map and returns plain symbols.
    expect(
      marketConfig.preprocessSubscriptionSymbols?.(['HDFCBANK:1333'], 'NSE_EQ'),
    ).toEqual(['HDFCBANK']);
    expect(marketConfig.preprocessSubscriptionSymbols?.(['2885'], 'BSE_EQ')).toEqual([
      '2885',
    ]);

    // Native names ride the generic builder: symbol@exchange@type (lowercased).
    expect(
      buildStreamNames('dhan_stream', ['HDFCBANK'], ['ticker', 'quote'], '', undefined, 'NSE_EQ'),
    ).toEqual(['hdfcbank@nse_eq@ticker', 'hdfcbank@nse_eq@quote']);
    expect(
      buildStreamNames('dhan_stream', ['2885'], ['ticker'], '', undefined, 'BSE_EQ'),
    ).toEqual(['2885@bse_eq@ticker']);

    expect(tradingConfig.redactAuthMessage?.(authMessage)).toEqual({
      LoginReq: {
        MsgCode: 42,
        ClientId: 'client-1',
        Token: '[REDACTED]',
      },
      UserType: 'SELF',
    });
    expect(authMessage.LoginReq.Token).toBe('token-1');
  });

  it('normalizes Dhan order_alert JSON to a Coreza order_update event', () => {
    const payload = {
      Type: 'order_alert',
      Data: {
        OrderNo: 'DHAN-123',
        ExchOrderNo: 'EXCH-456',
        CorrelationId: 'idem-789',
        Status: 'TRADED',
        TxnType: 'B',
        Quantity: 10,
        TradedQty: 10,
        RemainingQuantity: 0,
        AvgTradedPrice: 101.25,
        Symbol: 'RELIANCE',
        SecurityId: '2885',
        OrderType: 'LIMIT',
        ReasonDescription: '',
      },
    };

    const [message] = parseDhanMessage(Buffer.from(JSON.stringify(payload)), 'dhan_trading');
    const event = normalizeDhanMessage(message, 'dhan_trading');

    expect(event).toMatchObject({
      source: 'dhan',
      symbol: 'RELIANCE',
      type: 'order_update',
      orderId: 'DHAN-123',
      clientOrderId: 'idem-789',
      side: 'buy',
      orderStatus: 'filled',
      filledQty: 10,
      requestedQty: 10,
      filledAvgPrice: 101.25,
      orderSymbol: 'RELIANCE',
      executionId: 'EXCH-456',
      orderType: 'limit',
    });
  });


  it('parses Dhan feed disconnect packets as control messages with reason text', () => {
    const buffer = Buffer.alloc(10);
    buffer.writeUInt8(50, 0);
    buffer.writeInt16LE(10, 1);
    buffer.writeUInt8(1, 3);
    buffer.writeInt32LE(1333, 4);
    buffer.writeInt16LE(813, 8);

    const [message] = parseDhanMessage(buffer, 'dhan');

    expect(message).toEqual({
      type: 'feed_disconnect',
      SecurityId: '1333',
      ExchangeSegment: 'NSE_EQ',
      reasonCode: 813,
      reasonText: 'Invalid SecurityId',
    });
    expect(dhanGatewayConfig.identifyMessageType(message)).toBe('feed_disconnect');
    expect(dhanGatewayConfig.shouldPublish(message, 'dhan')).toBe(false);
    expect(dhanGatewayConfig.isFatalControlMessage?.(message, 'dhan')).toBe(true);
  });

  it('builds Dhan market WebSocket URLs from api_key or access_token without raw undefined tokens', () => {
    expect(
      getDhanWsUrl({ client_id: 'client-1', access_token: 'token one' }, 'dhan'),
    ).toBe('wss://api-feed.dhan.co?version=2&token=token%20one&clientId=client-1&authType=2');
    expect(
      getDhanWsUrl({ client_id: 'client-1', api_key: 'api-token', access_token: 'fallback' }, 'dhan'),
    ).toContain('token=api-token');
    expect(() => getDhanWsUrl({ client_id: 'client-1' }, 'dhan')).toThrow(
      'Dhan access token missing',
    );
  });

  it('sends Dhan market subscriptions as grouped JSON payloads and parses binary responses', () => {
    // Seed the resolution map so incoming ticks enrich back to the symbol.
    getBrokerStreamConfig('dhan').preprocessSubscriptionSymbols?.(['RELIANCE:2885'], 'NSE_EQ');
    const subscribeMessages = buildDhanSubscribeMessage(
      ['RELIANCE@2885@NSE_EQ@ticker', '500325@BSE_EQ@quote', '35000@NSE_FNO@full'],
      'dhan',
    );

    expect(subscribeMessages).toEqual([
      {
        RequestCode: 15,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }],
      },
      {
        RequestCode: 17,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'BSE_EQ', SecurityId: '500325' }],
      },
      {
        RequestCode: 21,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_FNO', SecurityId: '35000' }],
      },
    ]);
    expect(
      typeof dhanGatewayConfig.isBinary === 'function'
        ? dhanGatewayConfig.isBinary('dhan')
        : dhanGatewayConfig.isBinary,
    ).toBe(false);

    const buffer = Buffer.alloc(16);
    buffer.writeUInt8(2, 0);
    buffer.writeInt16LE(16, 1);
    buffer.writeUInt8(1, 3);
    buffer.writeInt32LE(2885, 4);
    buffer.writeFloatLE(2500.5, 8);
    buffer.writeInt32LE(1700000000, 12);

    const [message] = parseDhanMessage(buffer, 'dhan');
    const normalized = normalizeDhanMessage(message, 'dhan');

    expect(parseDhanMessage(buffer, 'dhan')).toEqual([
      {
        type: 'ticker',
        SecurityId: '2885',
        ExchangeSegment: 'NSE_EQ',
        LTP: 2500.5,
        LTT: 1700000000,
      },
    ]);
    expect(normalized).toMatchObject({
      symbol: 'RELIANCE',
      securityId: '2885',
      exchange: 'NSE_EQ',
      type: 'ticker',
      p: 2500.5,
    });
    expect(normalized?.symbol).toBe('RELIANCE');
    expect(normalized?.exchange).toBe('NSE_EQ');
  });

  it('fails loudly when a canonical Dhan stream cannot resolve its securityId', () => {
    expect(() =>
      buildDhanSubscribeMessage(['unmappedcoreza@nse_eq@full'], 'dhan'),
    ).toThrow(
      'Unable to resolve Dhan securityId for unmappedcoreza@nse_eq@full',
    );
  });

  it('enriches Dhan ticks from composite subscription metadata', () => {
    const marketConfig = getBrokerStreamConfig('dhan');
    const symbols = marketConfig.preprocessSubscriptionSymbols?.(['HDFCBANK:1333'], 'NSE_EQ') ?? [];
    const nativeStreams = buildStreamNames('dhan', symbols, ['ticker'], '', undefined, 'NSE_EQ');

    expect(symbols).toEqual(['HDFCBANK']);
    expect(nativeStreams).toEqual(['hdfcbank@nse_eq@ticker']);
    expect(buildDhanSubscribeMessage(nativeStreams, 'dhan')).toEqual([
      {
        RequestCode: 15,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '1333' }],
      },
    ]);
    expect(buildDhanSubscribeMessage(['hdfcbank@nse_eq@full'], 'dhan')).toEqual([
      {
        RequestCode: 21,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '1333' }],
      },
    ]);

    const event = normalizeDhanMessage(
      {
        type: 'ticker',
        SecurityId: '1333',
        ExchangeSegment: 'NSE_EQ',
        LTP: 1500.25,
      },
      'dhan',
    );

    expect(event).toMatchObject({
      symbol: 'HDFCBANK',
      securityId: '1333',
      exchange: 'NSE_EQ',
      type: 'ticker',
      p: 1500.25,
    });
  });

  it('chunks Dhan market requests at 100 instruments and uses matching unsubscribe codes', () => {
    const streamNames = Array.from(
      { length: 101 },
      (_, index) => `${1000 + index}@NSE_EQ@quote`,
    );

    expect(buildDhanSubscribeMessage(streamNames, 'dhan')).toEqual([
      {
        RequestCode: 17,
        InstrumentCount: 100,
        InstrumentList: streamNames.slice(0, 100).map((streamName) => ({
          ExchangeSegment: 'NSE_EQ',
          SecurityId: streamName.split('@')[0],
        })),
      },
      {
        RequestCode: 17,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '1100' }],
      },
    ]);
    expect(
      buildDhanUnsubscribeMessage(
        ['2885@NSE_EQ@ticker', '500325@BSE_EQ@quote', '35000@NSE_FNO@full'],
        'dhan',
      ),
    ).toEqual([
      {
        RequestCode: 16,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_EQ', SecurityId: '2885' }],
      },
      {
        RequestCode: 18,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'BSE_EQ', SecurityId: '500325' }],
      },
      {
        RequestCode: 22,
        InstrumentCount: 1,
        InstrumentList: [{ ExchangeSegment: 'NSE_FNO', SecurityId: '35000' }],
      },
    ]);
  });

  it('decodes Dhan full packets with OI, OHLC, and 5-level depth', () => {
    const buffer = Buffer.alloc(162);
    buffer.writeUInt8(8, 0);
    buffer.writeInt16LE(162, 1);
    buffer.writeUInt8(2, 3);
    buffer.writeInt32LE(35000, 4);

    buffer.writeFloatLE(101.5, 8);
    buffer.writeInt16LE(25, 12);
    buffer.writeInt32LE(1700000100, 14);
    buffer.writeFloatLE(100.75, 18);
    buffer.writeInt32LE(123456, 22);
    buffer.writeInt32LE(5000, 26);
    buffer.writeInt32LE(7000, 30);
    buffer.writeInt32LE(900, 34);
    buffer.writeInt32LE(1200, 38);
    buffer.writeInt32LE(800, 42);
    buffer.writeFloatLE(99.1, 46);
    buffer.writeFloatLE(98.2, 50);
    buffer.writeFloatLE(102.3, 54);
    buffer.writeFloatLE(97.4, 58);

    buffer.writeInt32LE(10, 62);
    buffer.writeInt32LE(20, 66);
    buffer.writeInt16LE(2, 70);
    buffer.writeInt16LE(3, 72);
    buffer.writeFloatLE(101.4, 74);
    buffer.writeFloatLE(101.6, 78);

    const [message] = parseDhanMessage(buffer, 'dhan');
    expect(message).toMatchObject({
      type: 'full',
      SecurityId: '35000',
      ExchangeSegment: 'NSE_FNO',
      LTP: 101.5,
      LTQ: 25,
      OI: 900,
      HighOI: 1200,
      LowOI: 800,
      Open: expect.closeTo(99.1),
      Close: expect.closeTo(98.2),
      High: expect.closeTo(102.3),
      Low: expect.closeTo(97.4),
      BidQty: 10,
      AskQty: 20,
    });
    expect(normalizeDhanMessage(message, 'dhan')).toMatchObject({
      symbol: '35000',
      type: 'full',
      p: 101.5,
      o: expect.closeTo(99.1),
      h: expect.closeTo(102.3),
      l: expect.closeTo(97.4),
      c: expect.closeTo(98.2),
      bids: [{ p: expect.closeTo(101.4), q: 10 }],
      asks: [{ p: expect.closeTo(101.6), q: 20 }],
    });
  });

  it('wires dhan_trading as Dhan companion trading source', () => {
    expect(SOURCE_MAPPING.dhan_trading).toEqual({ credentialServiceType: 'dhan', gatewaySource: 'dhan' });
    expect(getBrokerStreamConfig('dhan').companionSources).toContain('dhan_trading');
    expect(computeTradingNativeStreamsFromConfig('dhan_trading')).toEqual(['order_alert']);
    expect(getBrokerStreamConfig('dhan_trading').tradingRoutingKey?.('account_activity')).toBe('order_alert');
  });
});
