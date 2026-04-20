

# Plan: Binance USDⓈ-M Futures `ALGO_UPDATE` — Reuse `live_fills`

## What's already done ✅

| Area | Status |
|---|---|
| Algo placement → `POST /fapi/v1/algoOrder` for STOP/STOP_MARKET/TAKE_PROFIT/TAKE_PROFIT_MARKET/TRAILING_STOP_MARKET | ✅ |
| `clientAlgoId` correlation key | ✅ |
| Per-type payload validation (`triggerPrice`, `activatePrice`, `callbackRate`) | ✅ |
| Frontend node schema exposes the 5 conditional types | ✅ |

## What's missing ❌

| Gap | Impact |
|---|---|
| User-data stream URL only subscribes to `ORDER_TRADE_UPDATE` | `ALGO_UPDATE` / `listenKeyExpired` never received |
| No normalizer for `ALGO_UPDATE` | Algo lifecycle invisible after placement |
| `cancel_order` always routes to `/fapi/v1/order` | Cancelling a STOP_MARKET fails (-4120) |
| No `openAlgoOrders` reconciliation REST op | No recovery after disconnect |
| No persistence of algo lifecycle row | UI can't show Untriggered/Triggering/Rejected |
| `PortfolioExecutor` has no algo branch | Triggered child order won't link back to its algo parent |

## Decision: reuse `live_fills` — no new table, no new repository

`live_fills` already has every column we need to represent the algo lifecycle (the algo row is just a "pre-fill" lifecycle marker that gets superseded once the engine order produces real fills). Reuse it via three columns we already added:

- `fill_id` → store `algoId` (`aid`) for algo rows; broker exec id for engine fills (already)
- `fill_status` → store the algo's `X` value verbatim: `untriggered` / `triggering` / `triggered` / `finished` / `rejected` / `expired` / `canceled` (in addition to today's `partially_filled` / `filled`)
- `order_id` → store `engineOrderId` (`ai`) once the algo triggers — this is the same `order_id` engine fills use, so the UI naturally groups algo + its child fills under one order

Disambiguation: a small marker column distinguishes algo lifecycle rows from real fills.

### One tiny additive schema change

Add **one** nullable column to `live_fills` (no new table):

```sql
ALTER TABLE public.live_fills
  ADD COLUMN IF NOT EXISTS fill_kind text NOT NULL DEFAULT 'fill';
-- values: 'fill' (existing rows + future engine fills) | 'algo' (lifecycle markers)
```

No backfill needed — default `'fill'` keeps existing rows correct.

For algo rows: `qty = 0`, `price = triggerPrice`, `commission = 0`, `side` from algo, `event_time = E`, `fill_id = aid`, `order_id = ai` (null until triggered), `fill_status = X.toLowerCase()`, `commission_asset = rejectReason` (reuse the unused-for-algos column to carry `rm`) — or alternatively store `rejectReason` inside the existing `broker_execution_id` slot when status is `rejected`. Pick one in implementation; both avoid new columns.

Dedup is naturally handled by the existing unique constraint `(user_id, broker, symbol, fill_id)`: each `algoId` upserts its single lifecycle row, transitioning through statuses.

## Minimal implementation

### 1. Subscribe to `ALGO_UPDATE` + `listenKeyExpired`

**File:** `coreza-backend/market-stream-service/src/marketGateways/binance/helpers.ts`

- Change subscription URL to `events=ORDER_TRADE_UPDATE,ALGO_UPDATE,listenKeyExpired,ACCOUNT_UPDATE`.
- Update `shouldPublishBinanceMessage` to publish `ALGO_UPDATE` and `listenKeyExpired`.
- Add `ALGO_UPDATE` branch in `normalizeBinanceMessage` extracting `aid`, `caid`, `X` (algoStatus), `o` (orderType), `S`/`ps`, `q`, `tp`, `p`, `wt`, `R`, `cp`, `pP`, `ai` (engineOrderId), `ap`, `aq`, `tt`, `rm` (rejectReason).
- Add `listen_key_expired` passthrough type.

### 2. Add `algo_update` and `listen_key_expired` to event type union

**Files:** `coreza-backend/src/types/marketEvent.ts` + market-stream-service equivalent.

### 3. Algo-aware cancel routing

**File:** `coreza-backend/src/brokers/binance/http/operations.ts` (`cancel_order`)

`path` resolver: if `input.isAlgo === true` (or `orderType` ∈ ALGO_TYPES), use `/fapi/v1/algoOrder` and send `algoId` instead of `orderId`. Caller in `PortfolioExecutor.cancel_order` reads `isAlgo` from the stored order metadata (set when placement returned `aid`).

### 4. Reconciliation REST ops

Add `get_open_algo_orders` (GET `/fapi/v1/openAlgoOrders`) and `get_all_algo_orders` (GET `/fapi/v1/allAlgoOrders`) to operations.ts. Wire into `PortfolioExecutor` dispatch.

### 5. Lifecycle reducer in `PortfolioExecutor` — writes to `live_fills`

**File:** `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`

In `brokerSyncOrderEvent`, branch on `params.type === "algo_update"`:
- Build a `LiveFillRow` with `fill_kind: "algo"`, `fill_id: algoId`, `order_id: engineOrderId ?? null`, `fill_status: algoStatus.toLowerCase()`, `qty: 0`, `price: triggerPrice`, `commission: 0`, optional reject reason.
- Reuse the existing `FillEventBus.publish` path → `FillSyncWorker` → `LiveFillRepository.batchUpsert` (the existing `(user_id, broker, symbol, fill_id)` unique key naturally upserts the same algo row across status transitions). No new repository, no new worker.
- On `TRIGGERED` with `engineOrderId` → write a link `engineOrderId → algoId` in PortfolioManager memory so subsequent `ORDER_TRADE_UPDATE` rows for that order id can be tagged (cosmetic; optional).

For `listen_key_expired`: log + trigger `get_open_algo_orders` reconciliation for the affected workflow.

### 6. `FillStreamEvent` & `LiveFillRow` — additive fields only

**Files:** `coreza-backend/src/services/FillEventBus.ts`, `coreza-backend/src/repositories/LiveFillRepository.ts`

Add optional `fill_kind?: "fill" | "algo"` and optional `reject_reason?: string` to the interfaces. `LiveFillRepository.batchUpsert` keeps the same `onConflict: "user_id,broker,symbol,fill_id"` — works unchanged.

### 7. Frontend — show algo status

| File | Change |
|---|---|
| `src/integrations/supabase/types.ts` | Regenerate to pick up `fill_kind` |
| `src/hooks/useLiveStrategyDetail.ts` | When mapping fills, separate `fill_kind === "algo"` rows: surface as a "parent" badge on the trade whose `entry_order_id`/`exit_order_id` matches the algo's `order_id`. Map `fill_status` → display: `untriggered` → "Untriggered", `triggering` → "Triggering", `rejected` → "Rejected", `expired` → "Expired", `canceled` → "Canceled" |
| `src/components/backtest/TradesTable.tsx` | Header badge for algo parent (gray/blue/cyan/red+tooltip/amber); existing per-fill Partial/Filled badges unchanged |
| `src/hooks/useBacktestResults.ts` | Widen `orders[].status` union with the new algo states |

### 8. Tests

- `binanceAlgoUpdateNormalization.test.ts` — each `X` value normalizes correctly with `aid`/`caid`/`tp`/`rm`/`ai`.
- `binanceCancelAlgoRouting.test.ts` — STOP_MARKET cancel hits `/fapi/v1/algoOrder` with `algoId`; LIMIT cancel hits `/fapi/v1/order` with `orderId`.
- `portfolioExecutorAlgoLifecycle.test.ts` — NEW → TRIGGERING → TRIGGERED → FINISHED produces a single `live_fills` row (upserted) with `fill_kind='algo'` whose `fill_status` ends at `finished` and `order_id` populated.

## Validation (testnet)

1. Place STOP_MARKET sell BTCUSDT → one row appears in `live_fills` with `fill_kind='algo'`, `fill_status='new'/'untriggered'`, `qty=0`, `price=triggerPrice`.
2. Move price → same row updates through `triggering` → `triggered` (now has `order_id` = engine `ai`) → `finished`. Engine order produces normal `fill_kind='fill'` rows sharing the same `order_id`.
3. Place + cancel before trigger → row ends `canceled`; REST hit `/fapi/v1/algoOrder`.
4. Insufficient margin → row ends `rejected` with `reject_reason` populated.
5. Force listenKey expiry → `listen_key_expired` observed, keepalive recreates key, reconciliation upserts current open algos.
6. Regular `MARKET`/`LIMIT` orders unchanged (regression check).

## Files touched

| File | Change |
|---|---|
| Supabase migration | Add `live_fills.fill_kind text NOT NULL DEFAULT 'fill'` (single column) |
| `coreza-backend/market-stream-service/.../binance/helpers.ts` | Subscribe to ALGO_UPDATE + listenKeyExpired; normalize both |
| `coreza-backend/src/types/marketEvent.ts` (+ stream-service mirror) | Add `algo_update`, `listen_key_expired` |
| `coreza-backend/src/brokers/binance/http/operations.ts` | Algo-aware cancel routing; new `get_open_algo_orders`, `get_all_algo_orders` |
| `coreza-backend/src/services/FillEventBus.ts` | Add optional `fill_kind`, `reject_reason` to `FillStreamEvent` |
| `coreza-backend/src/repositories/LiveFillRepository.ts` | Add same optional fields to `LiveFillRow` |
| `coreza-backend/src/workers/FillSyncWorker.ts` | Forward `fill_kind` + `reject_reason` to row payload (no new logic) |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Branch on `algo_update`; build algo row; reuse FillEventBus |
| `src/integrations/supabase/types.ts` | Regenerate |
| `src/hooks/useLiveStrategyDetail.ts` | Split algo rows from fill rows when mapping |
| `src/components/backtest/TradesTable.tsx` | Algo parent badge + reject tooltip |
| `src/hooks/useBacktestResults.ts` | Widen status union |
| Tests (3 new) | Normalization, cancel routing, algo lifecycle upsert |

