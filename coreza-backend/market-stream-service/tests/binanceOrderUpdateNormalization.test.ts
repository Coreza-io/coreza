import {
  identifyBinanceMessageType,
  normalizeBinanceMessage,
  shouldPublishBinanceMessage,
} from "../src/marketGateways/binance/helpers";
import { MarketDataSubscriber } from "../src/services/MarketDataSubscriber";

describe("Binance order_update normalization", () => {
  it("maps spot executionReport fields required by portfolio sync", () => {
    const event = normalizeBinanceMessage(
      {
        e: "executionReport",
        E: 1710000000000,
        s: "btcusdt",
        x: "TRADE",
        i: 12345,
        c: "my-client-order-id",
        S: "BUY",
        z: "0.25",
        Z: "12500",
        X: "PARTIALLY_FILLED",
        q: "1.0",
        t: 99887766,
        o: "LIMIT",
        n: "0.5",
        N: "USDT",
      },
      "binance_trading",
    );

    expect(event).toMatchObject({
      type: "order_update",
      source: "binance",
      orderEvent: "fill",
      orderId: "12345",
      clientOrderId: "my-client-order-id",
      requestedQty: 1,
      executionId: "99887766",
      orderType: "limit",
      feeAmount: 0.5,
      feeAsset: "USDT",
    });
    expect(event?.rawOrderData).toBeDefined();
  });

  it("maps futures ORDER_TRADE_UPDATE fields required by portfolio sync", () => {
    const event = normalizeBinanceMessage(
      {
        e: "ORDER_TRADE_UPDATE",
        E: 1710000000001,
        o: {
          s: "ethusdt",
          x: "TRADE",
          i: 67890,
          c: "futures-client-id",
          S: "SELL",
          z: "2",
          ap: "3500.5",
          X: "FILLED",
          q: "2",
          t: 11223344,
          o: "MARKET",
          n: "1.25",
          N: "USDT",
        },
      },
      "binance_trading",
    );

    expect(event).toMatchObject({
      type: "order_update",
      source: "binance",
      orderEvent: "fill",
      orderId: "67890",
      clientOrderId: "futures-client-id",
      requestedQty: 2,
      executionId: "11223344",
      orderType: "market",
      feeAmount: 1.25,
      feeAsset: "USDT",
    });
    expect(event?.rawOrderData).toBeDefined();
  });
});

describe("order_update payload formatting", () => {
  it("passes fee fields through formatMarketEventPayload order object", () => {
    const subscriber = MarketDataSubscriber.getInstance() as any;
    const payload = subscriber.formatMarketEventPayload({
      source: "binance",
      symbol: "BTCUSDT",
      type: "order_update",
      t: 1710000000000,
      orderEvent: "fill",
      orderId: "order-1",
      feeAmount: 0.1,
      feeAsset: "BNB",
    });

    expect(payload.data.order.feeAmount).toBe(0.1);
    expect(payload.data.order.feeAsset).toBe("BNB");
  });

  it("routes algo_update through order_update delivery stream payload shape", () => {
    const subscriber = MarketDataSubscriber.getInstance() as any;
    const payload = subscriber.formatMarketEventPayload({
      source: "binance",
      symbol: "BTCUSDT",
      type: "algo_update",
      t: 1710000000001,
      algoId: "algo-1",
      orderStatus: "triggering",
    });

    expect(payload.data.type).toBe("algo_update");
    expect(payload.data.order.algoId).toBe("algo-1");
  });
});

describe("Binance continuous kline event normalization", () => {
  it("normalizes websocket event type continuous_kline to continuousKline", () => {
    const msg = {
      e: "continuous_kline",
      E: 1710000000100,
      ps: "ethusdt",
      ct: "PERPETUAL",
      k: {
        t: 1710000000000,
        o: "2500",
        h: "2510",
        l: "2495",
        c: "2505",
        v: "123.45",
        i: "1m",
        x: true,
      },
    };

    expect(identifyBinanceMessageType(msg)).toBe("continuousKline");
    expect(shouldPublishBinanceMessage(msg, "binance_market")).toBe(true);

    const event = normalizeBinanceMessage(msg, "binance_market");
    expect(event).toMatchObject({
      type: "continuousKline",
      symbol: "ETHUSDT",
      timeframe: "1m",
      contractType: "perpetual",
      isClosed: true,
    });
  });
});

describe("Binance spot bookTicker normalization", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("infers bookTicker type for spot payloads without an event type", () => {
    jest.spyOn(Date, "now").mockReturnValue(1710000000200);

    const msg = {
      u: 5426915,
      s: "BTCUSDT",
      b: "63812.00",
      B: "0.5627",
      a: "63812.01",
      A: "34.52",
    };

    expect(identifyBinanceMessageType(msg)).toBe("bookTicker");
    expect(shouldPublishBinanceMessage(msg, "binance_stream")).toBe(true);

    expect(normalizeBinanceMessage(msg, "binance_stream")).toMatchObject({
      type: "bookTicker",
      source: "binance",
      symbol: "BTCUSDT",
      t: 1710000000200,
      b: 63812,
      B: 0.5627,
      a: 63812.01,
      A: 34.52,
    });
  });

  it("preserves futures bookTicker event timestamps", () => {
    const msg = {
      e: "bookTicker",
      E: 1710000000300,
      T: 1710000000299,
      u: 5426916,
      s: "ETHUSDT",
      b: "3500.10",
      B: "1.25",
      a: "3500.20",
      A: "2.50",
    };

    expect(identifyBinanceMessageType(msg)).toBe("bookTicker");
    expect(shouldPublishBinanceMessage(msg, "binance_stream")).toBe(true);

    expect(normalizeBinanceMessage(msg, "binance_stream")).toMatchObject({
      type: "bookTicker",
      source: "binance",
      symbol: "ETHUSDT",
      t: 1710000000300,
      b: 3500.1,
      B: 1.25,
      a: 3500.2,
      A: 2.5,
    });
  });

  it("does not classify malformed messages as bookTicker", () => {
    const msg = {
      u: 5426917,
      s: "BTCUSDT",
      b: "63812.00",
      B: "0.5627",
    };

    expect(identifyBinanceMessageType(msg)).toBeUndefined();
    expect(shouldPublishBinanceMessage(msg, "binance_stream")).toBe(false);
    expect(normalizeBinanceMessage(msg, "binance_stream")).toBeNull();
  });
});
