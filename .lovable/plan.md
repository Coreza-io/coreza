

# Plan: Add Tabbed Balance + Position Fields to Portfolio `create_portfolio` Operation

## Summary

Replace the current "Sync from Broker" toggle (which auto-fetches account data from Alpaca) with a tabbed UI inside the Portfolio node. When `create_portfolio` is selected, users see two tabs: **Balance** and **Position**. Both tabs populate their own fields simultaneously when the node loads. The backend reads these fields to seed the `PortfolioManager` with explicit user-provided values instead of calling the broker API.

## Current Behavior

When `create_portfolio` + `sync_from_broker=true`: the backend calls Alpaca's `get_account`, `get_positions`, and `get_orders` APIs to auto-populate cash, positions, and open orders. This is being removed.

## New Behavior

The user manually enters balance and position data in the node UI via tabs. The backend seeds `PortfolioManager` with these explicit values. No broker API calls during `create_portfolio`.

## Frontend Changes

### 1. Add `tab` field type support to `NodeFieldRenderer.tsx`

Introduce a new field type `"tabs"` that renders a Radix `Tabs` component (already available in `src/components/ui/tabs.tsx`). The tab field definition specifies tab names, and child fields use `displayOptions` to bind to a tab value.

**Field definition pattern in JSON:**
```json
{
  "key": "portfolio_tab",
  "type": "tabs",
  "label": "",
  "tabs": [
    { "id": "balance", "label": "Balance" },
    { "id": "position", "label": "Position" }
  ],
  "default": "balance",
  "displayOptions": {
    "show": { "operation": ["create_portfolio"], "mode": ["broker"] }
  }
}
```

Child fields then use `displayOptions.show.portfolio_tab: ["balance"]` or `["position"]` to appear under the correct tab.

**Rendering logic**: When `NodeFieldRenderer` encounters `type: "tabs"`, it renders a `Tabs` + `TabsList` + `TabsTrigger` set. The selected tab value is stored in `fieldState["portfolio_tab"]`, and child fields' existing `displayOptions.show` logic already handles visibility — no special rendering needed beyond the tab selector itself.

### 2. Update `Portfolio.json` — Remove sync fields, add tab + balance/position fields

**Remove:**
- `sync_from_broker` toggle field
- `credential_id` field (under create_portfolio context only — keep it for other operations)
- `environment` field (under create_portfolio context only)

**Add — Tab selector:**
```json
{ "key": "portfolio_tab", "type": "tabs", "tabs": [...], "default": "balance" }
```

**Add — Balance tab fields** (shown when `portfolio_tab: "balance"`):

| Key | Label | Type | Placeholder |
|-----|-------|------|-------------|
| `balance_cash` | Cash | text | e.g. 100000 |
| `balance_buying_power` | Buying Power | text | e.g. 400000 |
| `balance_equity` | Equity | text | e.g. 105000 |
| `balance_margin` | Margin Multiplier | text | e.g. 4 |
| `balance_initial_margin` | Initial Margin | text | e.g. 0 |

All with `displayOptions.show: { operation: ["create_portfolio"], mode: ["broker"], portfolio_tab: ["balance"] }`

**Add — Position tab fields** (shown when `portfolio_tab: "position"`):

| Key | Label | Type | Placeholder |
|-----|-------|------|-------------|
| `position_symbol` | Symbol | text | e.g. ETH/USD |
| `position_side` | Side | select | long / short |
| `position_quantity` | Quantity | text | e.g. 10 |
| `position_avg_fill_price` | Avg Fill Price | text | e.g. 2500.50 |
| `position_current_price` | Current Price | text | e.g. 2600.00 |
| `position_open_cost_basis` | Open Cost Basis | text | (auto: qty * avgFillPrice) |
| `position_market_value` | Market Value | text | (auto: qty * currentPrice) |
| `position_realized_pnl` | Realized PnL | text | e.g. 0 |
| `position_unrealized_pnl` | Unrealized PnL | text | (auto: marketValue - costBasis) |

All with `displayOptions.show: { operation: ["create_portfolio"], mode: ["broker"], portfolio_tab: ["position"] }`

**Keep:** `base_currency` and `cash_balance` fields remain for backtest mode (they already have `displayOptions` that exclude broker mode or have no mode filter).

### 3. Update node size in `Portfolio.json`

Increase height to accommodate the new tabbed fields (from current to ~420px).

## Backend Changes

### 4. Update `PortfolioExecutor.ts` — `create_portfolio` operation (line 336-370)

Replace the current `syncFromBroker` branch with explicit field reading:

```typescript
if (operation === "create_portfolio") {
  if (pm.isBootstrapped()) {
    return /* already initialized response */;
  }

  // Read balance fields
  const cash = toNumber(params.balance_cash ?? params.cash_balance) ?? 0;
  pm.initializePortfolio(baseCurrency, cash);

  // Reconcile balance with explicit values
  pm.reconcileBalance({
    asset: baseCurrency,
    cash,
    buyingPower: toNumber(params.balance_buying_power),
    initialMargin: toNumber(params.balance_initial_margin),
    margin: toNumber(params.balance_margin) ?? 1,
    equity: toNumber(params.balance_equity) ?? cash,
  });

  // Seed position if provided
  if (params.position_symbol && toNumber(params.position_quantity) > 0) {
    const side = params.position_side === "short" ? "sell" : "buy";
    pm.applyPositionUpdate({
      symbol: params.position_symbol.toUpperCase().trim(),
      positionQty: toNumber(params.position_quantity),
      avgFillPrice: toNumber(params.position_avg_fill_price) ?? 0,
      side,
      currentPrice: toNumber(params.position_current_price),
    });
  }

  return toNodeResult(createSuccessOutput({
    message: "Portfolio created with explicit balance and position data",
    created: true,
    ...this.getPortfolioSummary(pm, baseCurrency),
  }));
}
```

**Keep `sync_broker_state`** as a separate operation — it already exists and can be used independently if the user wants to sync later.

### 5. Update `portfolio.ts` route schema

Add the new field keys to the Zod schema: `balance_cash`, `balance_buying_power`, `balance_equity`, `balance_margin`, `balance_initial_margin`, `position_symbol`, `position_side`, `position_quantity`, `position_avg_fill_price`, `position_current_price`, `position_open_cost_basis`, `position_market_value`, `position_realized_pnl`, `position_unrealized_pnl`, `portfolio_tab`.

## Files Changed

| File | Change |
|------|--------|
| `src/components/nodes/layout/components/NodeFieldRenderer.tsx` | Add `case "tabs"` rendering with Radix Tabs component |
| `src/nodes/Portfolio.json` | Remove sync fields, add `portfolio_tab` + balance/position fields |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Replace `syncFromBroker` branch with explicit field reading |
| `coreza-backend/src/routes/portfolio.ts` | Add new field keys to Zod schema |

## What Stays the Same

- `sync_broker_state` operation (separate from `create_portfolio`) — still available
- Backtest mode `create_portfolio` — still uses `cash_balance` field
- All other portfolio operations — untouched
- `PortfolioManager.initializePortfolio()` and `reconcileBalance()` APIs — called with explicit values instead of broker API responses

