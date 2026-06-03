import { dhanGatewayConfig } from '../src/marketGateways/dhan/config';
import { buildDhanSubscribeMessage, normalizeDhanMessage, parseDhanMessage } from '../src/marketGateways/dhan/helpers';
import { computeTradingNativeStreamsFromConfig, getBrokerStreamConfig } from '../src/config/brokerStreamConfig';
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
    expect(getDhanOrderUpdateWsUrl('sandbox')).toBe('wss://api-order-update.dhan.co');
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

  it('keeps the binary market parser path unchanged for dhan market sources', () => {
    const buffer = Buffer.alloc(13);
    buffer.writeUInt16LE(15, 0);
    buffer.writeUInt16LE(1, 2);
    buffer.writeUInt8(1, 4);
    buffer.writeUInt32LE(2885, 5);
    buffer.writeFloatLE(2500.5, 9);

    expect(
      typeof dhanGatewayConfig.isBinary === 'function'
        ? dhanGatewayConfig.isBinary('dhan')
        : dhanGatewayConfig.isBinary,
    ).toBe(true);
    expect(
      typeof dhanGatewayConfig.isBinary === 'function'
        ? dhanGatewayConfig.isBinary('dhan_trading')
        : dhanGatewayConfig.isBinary,
    ).toBe(false);
    expect(parseDhanMessage(buffer, 'dhan')).toEqual([
      {
        type: 'ticker',
        SecurityId: '2885',
        ExchangeSegment: 'NSE_EQ',
        LTP: 2500.5,
      },
    ]);
  });

  it('wires dhan_trading as Dhan companion trading source', () => {
    expect(SOURCE_MAPPING.dhan_trading).toEqual({ credentialServiceType: 'dhan', gatewaySource: 'dhan' });
    expect(getBrokerStreamConfig('dhan').companionSources).toContain('dhan_trading');
    expect(computeTradingNativeStreamsFromConfig('dhan_trading')).toEqual(['order_alert']);
    expect(getBrokerStreamConfig('dhan_trading').tradingRoutingKey?.('account_activity')).toBe('order_alert');
  });
});
