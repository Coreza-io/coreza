

# Plan: Fill Deduplication & Order Ownership Verification for Portfolio Sync Fills

## Status: ✅ IMPLEMENTED

## Problem
Portfolio Sync Fills had no deduplication or order ownership verification. Duplicate WebSocket events would double-count fills, and fills from external orders (manual trades, other systems) on the same Alpaca account would be incorrectly applied.

## Solution: Opaque `fill_id` + Redis Reverse Index

### 1. `orderIdempotency.ts` — Reverse index + `isOurOrder()`
- `updateOrderCache()` now creates `order-reverse:{orderId}` → `idempotencyKey` in Redis
- New `isOurOrder(orderId)` checks the reverse index to verify order ownership

### 2. `PortfolioManager.ts` — Dedup in `applyFill()`
- Accepts optional `fillId` parameter
- Checks `fillIdSet` with key `${symbol}:${fillId}` before applying
- Returns `{ applied: boolean; reason?: string }` instead of void

### 3. `PortfolioExecutor.ts` — Ownership + dedup wiring
- Reads `fill_id` from params
- Calls `isOurOrder(fill_id)` → skips with `reason: "unknown_order"` if not ours
- Passes `fillId` to `applyFill()` → skips with `reason: "duplicate"` if already processed
- Output includes `skipped`, `reason`, `fill_id` fields

### 4. `Portfolio.json` — New `fill_id` field
- Optional text field for `update_portfolio` operation
- Placeholder: `{{ $(AlpacaStreamData).json.data.order.orderId }}`

## Workflow Usage
```text
Portfolio (Sync Fills):
  fill_id: {{ $(AlpacaStreamData).json.data.order.orderId }}
```

Flow: ownership check → dedup check → apply fill
