import { normalizeBinanceMessage, shouldPublishBinanceMessage } from "../src/marketGateways/binance/helpers";

describe("Binance ALGO_UPDATE normalization", () => {
  it("normalizes each algo lifecycle status and core fields", () => {
    const statuses = [
      "UNTRIGGERED",
      "TRIGGERING",
      "TRIGGERED",
      "FINISHED",
      "REJECTED",
      "EXPIRED",
      "CANCELED",
    ];

    for (const status of statuses) {
      const event = normalizeBinanceMessage(
        {
          e: "ALGO_UPDATE",
          E: 1710000000002,
          o: {
            s: "btcusdt",
            aid: "987654",
            caid: "client-algo-1",
            X: status,
            o: "STOP_MARKET",
            S: "SELL",
            ps: "LONG",
            q: "0.01",
            tp: "60000",
            p: "0",
            wt: "MARK_PRICE",
            R: true,
            cp: false,
            pP: true,
            ai: "123456",
            ap: "0",
            aq: "0",
            tt: 1710000000010,
            rm: status === "REJECTED" ? "INSUFFICIENT_MARGIN" : undefined,
          },
        },
        "binance_trading",
      );

      expect(event).toMatchObject({
        type: "algo_update",
        symbol: "BTCUSDT",
        algoId: "987654",
        clientAlgoId: "client-algo-1",
        orderId: "123456",
        orderStatus: status.toLowerCase(),
        triggerPrice: 60000,
      });
      if (status === "REJECTED") {
        expect(event?.rejectReason).toBe("INSUFFICIENT_MARGIN");
      }
    }
  });

  it("publishes ALGO_UPDATE and listenKeyExpired", () => {
    expect(shouldPublishBinanceMessage({ e: "ALGO_UPDATE" }, "binance_trading")).toBe(true);
    expect(shouldPublishBinanceMessage({ e: "listenKeyExpired" }, "binance_trading")).toBe(true);

    const listenKeyExpired = normalizeBinanceMessage(
      { e: "listenKeyExpired", E: 1710000000100 },
      "binance_trading",
    );
    expect(listenKeyExpired).toMatchObject({ type: "listen_key_expired" });
  });
});
