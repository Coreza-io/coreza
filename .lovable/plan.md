
# Portfolio Module Refactor — Implemented

## Summary

Refactored the broker-mode portfolio from a fill-centric model (register_order + update_portfolio) to a canonical order/execution/position/balance projector model.

## Core Principle

Each concern has its own method — no single field controls order progress, execution accounting, position quantity, AND balance changes:

- **applyOrderUpdate** → order lifecycle state only
- **applyExecution** → cash/fees/execution ledger + execution-derived position delta
- **reconcilePosition** → absolute broker position quantity (fixes Alpaca 1 vs 0.9982)
- **reconcileBalance** → asset balance snapshot (supports BNB fee asset)
- **registerOrderIntent** → order intent registration (no cash/position mutation)

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/simulation/PortfolioManager.ts` | Added OrderState, ExecutionRecord, PositionState, BalanceState interfaces. Added v2 state maps. Added 5 new public methods + instrument parser. Legacy methods kept as deprecated wrappers that also populate v2 state. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Added 5 new broker-mode switch cases (register_order_intent, apply_order_update, apply_execution, reconcile_position, reconcile_balances). Legacy operations (register_order, update_portfolio) route through existing code with `legacy_operation_used: true` flag. Added parameter normalizer helpers. |
| `coreza-backend/src/routes/portfolio.ts` | Expanded Zod schema with all v2 fields (broker_order_id, execution_id, exec_qty, exec_price, position_qty, fee_amount, fee_asset, asset, total, available, locked, etc.) plus legacy aliases. |
| `src/nodes/Portfolio.json` | Replaced with new node definition supporting all v2 operations with proper displayOptions per operation. |

## Broker Event Mapping

```
Alpaca fill event → 3 calls:
  1. apply_order_update (order.status, order.filled_qty)
  2. apply_execution   (price, qty, execution_id)
  3. reconcile_position (position_qty = 0.9982)

Binance executionReport → 2 calls:
  1. apply_order_update (msg.X status, msg.z cumQty)
  2. apply_execution   (msg.l lastQty, msg.L lastPrice, msg.n fee, msg.N feeAsset)

Binance ACCOUNT_UPDATE → 2 calls:
  1. reconcile_position (position qty)
  2. reconcile_balances (asset balances)
```

## Migration Path

1. ✅ Phase 1-3: New methods + executor operations + route schema + JSON (DONE)
2. Phase 4: Update workflow graphs to use new operations
3. Phase 5: Remove legacy applyFill(), registerOrder(), update_portfolio after migration
