

# Review: BinanceStreamData Node — End-to-End Analysis

## Verdict: Node JSON is correct. One backend bug found in the register endpoint.

### What's Working Well

**Node JSON (BinanceStreamData.json)** — All correct:
- `stream_types` is multiselect with all 7 Binance types + `order_update`
- `interval` correctly shown only when `kline` is selected (Binance supports 15 intervals)
- `onlyClosedBars` is hidden with default `true` — unclosed kline bars are filtered server-side in `MarketDataSubscriber.ts` (line 339-354)
- Listen-mode filters (`filter_symbols`, `filter_types`) present
- Description mentions If node routing pattern

**Node JSON (BinanceSubscribe.json)** — All correct:
- `stream_types` multiselect with `order_update` option
- Interval/depth displayOptions work with multiselect

**Gateway (binance/helpers.ts)** — Solid implementation:
- `preConnectBinance()` fetches listenKey via REST, sets up 30-min refresh interval
- `shouldPublishBinanceMessage()` correctly filters `executionReport` (spot) and `ORDER_TRADE_UPDATE` (futures) for trading source
- `normalizeBinanceMessage()` maps both spot and futures order events to unified `order_update` type with proper field extraction
- Kline normalization includes `isClosed` flag for server-side filtering
- All 7 market data types properly normalized

**Subscribe endpoint (`/stream/:source/subscribe`)** — Correct:
- Splits `order_update` from `stream_types` (lines 114-131)
- Routes `order_update` to `binance_trading` with wildcard symbols `["*"]`
- Passes remaining market types to market source

**Unsubscribe endpoint** — Correct: same splitting logic

**MarketDataSubscriber** — Correct:
- `onlyClosedBars` filtering (default true) skips unclosed Binance klines
- Only applies to `source === "binance"` and `type === "kline"`

### Bug Found: Register Endpoint Missing order_update Splitting

**File**: `coreza-backend/src/routes/stream.ts`, lines 417-448

The `/stream/:source/register` endpoint (used by BinanceStreamData in **subscribe mode**) passes `stream_types` directly to `SubscriptionService.subscribe()` without splitting out `order_update`. This means if a user selects `["kline", "order_update"]` in subscribe mode, the `order_update` type gets sent to `binance_market` instead of being routed to `binance_trading`.

The `/subscribe` endpoint (used by BinanceSubscribe node) handles this correctly at lines 114-131.

**Fix**: Add the same `order_update` splitting logic to the register endpoint's subscribe-mode block (before line 429).

## Plan

| File | Change |
|---|---|
| `coreza-backend/src/routes/stream.ts` | In the register endpoint (line ~417-448), add `order_update` splitting: extract `hasOrderUpdate` and `marketStreamTypes`, subscribe to trading source separately if `order_update` is present, pass only market types to the main subscription |

### Specific Change

In the register endpoint's subscribe-mode block, before calling `SubscriptionService.subscribe()`:

1. Parse `stream_types` into array (same as subscribe endpoint)
2. Check for `order_update`, split into `marketStreamTypes`
3. If `hasOrderUpdate`, call `SubscriptionService.subscribe()` for the trading source (`binance_trading` or `alpaca_trading`) with `symbols: ["*"]` and `streamTypes: ["order_update"]`
4. Pass only `marketStreamTypes` to the existing market subscription call
5. If only `order_update` was selected (no market types), skip the market subscription and return success

This is identical to the pattern already used at lines 114-154 of the same file.

