

# Add Daily Bars + Remove Interval Field

## Changes

### 1. `src/nodes/AlpacaSubscribe.json`
- Add `daily_bar` option to `stream_types` multiselect: `{ "id": "daily_bar", "name": "Daily Bars" }`
- Remove the `interval` field entirely from the JSON — bars will always default to `1m` interval
- Add a hidden/implicit `interval` field with `"type": "hidden"`, `"default": "1m"` so the value is always sent with the request body. Alternatively, handle this server-side.

Actually, simpler: just remove the `interval` field from the JSON completely. The backend already defaults to `"1m"` — in `MarketDataSubscriber.ts` line 442: `interval: event.timeframe || "1m"`, and `MarketControlHandler.ts` line 773 only applies interval processing for Binance klines, not Alpaca bars. The interval field was cosmetic for Alpaca.

### 2. Backend — no changes needed
- `daily_bar` is already mapped in `helpers.ts` (`daily_bar → dailyBars`)
- Normalization already handles `msg.T === "d"` → `type: "daily_bar"`
- `buildAlpacaSubscribeMessage` uses `ALPACA_TYPE_TO_KEY` which already maps `daily_bar → dailyBars`
- Stream route passes `streamTypes` array directly — `daily_bar` will flow through correctly

### Summary of JSON changes

**`stream_types` field** — add Daily Bars option:
```json
{
  "id": "daily_bar",
  "name": "Daily Bars"
}
```

**`interval` field** — remove entirely (lines 134-152). The backend already defaults to `"1m"` for bar timeframes.

