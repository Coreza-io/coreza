

# Update Portfolio: Use Explicit Fields Instead of Fill Data Blob

## Problem

The previous plan proposed a single `fill_data` textarea for `update_portfolio`, expecting the user to pass the entire Trade node JSON output. This is fragile and opaque. Instead, use three explicit fields -- `symbol`, `quantity`, and `price` -- that the user can wire individually from the Trade node output or type manually.

## Changes

### 1. Replace `fill_data` with explicit fields in `Portfolio.json`

Remove the proposed `fill_data` textarea. Instead, show `symbol`, `quantity`, and `price` fields when `operation = update_portfolio`:

```json
{
  "key": "symbol",
  "label": "Symbol",
  "type": "text",
  "placeholder": "{{ $('BinanceTrade').json.symbol }}",
  "required": true,
  "displayOptions": { "show": { "operation": ["update_portfolio", "get_position", "update_mtm", "sync_trades", "get_pending_orders"] } }
},
{
  "key": "quantity",
  "label": "Quantity",
  "type": "text",
  "placeholder": "{{ $('BinanceTrade').json.executedQty }}",
  "required": true,
  "description": "Filled quantity. Positive for BUY, negative for SELL.",
  "displayOptions": { "show": { "operation": ["update_portfolio"] } }
},
{
  "key": "price",
  "label": "Price",
  "type": "text",
  "placeholder": "{{ $('BinanceTrade').json.avgPrice }}",
  "required": true,
  "description": "Average fill price.",
  "displayOptions": { "show": { "operation": ["update_portfolio"] } }
}
```

Quantity uses the QC convention: positive = BUY, negative = SELL. This is simpler than a separate `side` field.

### 2. Optional fields for commissions

Add an optional `commission` field for accurate cash tracking:

```json
{
  "key": "commission",
  "label": "Commission",
  "type": "text",
  "placeholder": "0",
  "required": false,
  "default": "0",
  "description": "Trade commission (deducted from cash).",
  "displayOptions": { "show": { "operation": ["update_portfolio"] } }
}
```

### 3. Update `PortfolioExecutor.ts` -- `update_portfolio` case

Instead of parsing a fill blob, read the three explicit params:

```text
case "update_portfolio": {
  const symbol = params.symbol?.trim().toUpperCase();
  const quantity = parseFloat(params.quantity);   // positive=BUY, negative=SELL
  const price = parseFloat(params.price);
  const commission = parseFloat(params.commission || "0");

  if (!symbol) return error("symbol is required");
  if (isNaN(quantity) || quantity === 0) return error("quantity must be non-zero");
  if (isNaN(price) || price <= 0) return error("price must be positive");

  pm.applyFill({ symbol, quantity, price, commission });
  return success({ updated: true, ...this.getPortfolioSummary(pm) });
}
```

### 4. Update `PortfolioManager.ts` -- new `applyFill` method

A clean method that takes the three values and applies both the accounting loop updates:

```text
applyFill(fill: { symbol: string; quantity: number; price: number; commission?: number }): void {
  const { symbol, quantity, price, commission = 0 } = fill;
  const side = quantity > 0 ? "BUY" : "SELL";
  const absQty = Math.abs(quantity);

  // 1. Update holdings (quantity, avg price, realized PnL)
  // -- same logic as existing applyFillToHoldings

  // 2. Update cash (accounting loop)
  const cost = absQty * price;
  const baseCurrency = this.baseCurrency || "USDT";
  const currentCash = this.cashBook.get(baseCurrency) ?? 0;
  if (side === "BUY") {
    this.cashBook.set(baseCurrency, currentCash - cost - commission);
  } else {
    this.cashBook.set(baseCurrency, currentCash + cost - commission);
  }
}
```

### 5. Workflow wiring after this change

```text
[Create Portfolio]
  base_currency: USDT
  cash_balance: 64786
       |
       v
[BinanceTrade]  -- places order, returns fill info
       |
       v
[Update Portfolio]  -- Accounting loop
  symbol:     {{ $('BinanceTrade').json.symbol }}
  quantity:   {{ $('BinanceTrade').json.executedQty }}
  price:      {{ $('BinanceTrade').json.avgPrice }}
  commission: {{ $('BinanceTrade').json.commission }}
       |
       v
[Update MTM]  -- Valuation loop (on each bar)
  current_bar: {{ $('OnBar').json.bar }}
       |
       v
[Get Portfolio]  -- pure memory read
```

## Files Changed

| File | Change |
|---|---|
| `src/nodes/Portfolio.json` | Replace `fill_data` with `quantity`, `price`, `commission` fields for `update_portfolio`. Update symbol displayOptions. |
| `coreza-backend/src/services/PortfolioManager.ts` | Add `applyFill({ symbol, quantity, price, commission })` method. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Update `update_portfolio` case to read explicit fields and call `pm.applyFill()`. |

