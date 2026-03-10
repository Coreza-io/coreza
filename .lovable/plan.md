

# Plan: Unified Order Schema (QC Lean Pattern)

## Goal

Create a single set of order types (`Order`, `OrderEvent`, `OrderTicket`) shared by both SimBroker (backtest) and PortfolioManager (live), following the QuantConnect Lean pattern of **immutable orders + append-only events + aggregate ticket**.

## New File: `coreza-backend/src/types/order.ts`

```ts
// ============== ENUMS ==============
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop_market' | 'stop_limit' | 'market_on_open' | 'market_on_close';
export type OrderStatus = 'new' | 'submitted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'invalid';

// ============== ORDER (immutable after creation) ==============
export interface Order {
  id: string;
  brokerId?: string[];
  symbol: string;
  quantity: number;
  orderType: OrderType;
  side: OrderSide;
  status: OrderStatus;
  limitPrice?: number;
  stopPrice?: number;
  createdAt: string;
  tag?: string;
  properties?: {
    timeInForce?: string;
    extendedHours?: boolean;
  };
}

// ============== ORDER EVENT (append-only) ==============
export interface OrderFee {
  value: number;
  currency: string;
}

export interface OrderEvent {
  orderId: string;
  symbol: string;
  utcTime: string;
  status: OrderStatus;
  side: OrderSide;
  fillPrice: number;
  fillQuantity: number;
  orderFee?: OrderFee;
  slippage?: number;
  message?: string;
}

// ============== ORDER TICKET (aggregate) ==============
export interface OrderTicket {
  orderId: string;
  order: Order;
  orderEvents: OrderEvent[];
  quantityFilled: number;
  averageFillPrice: number;
  totalFees: number;
}
```

## Files to Change

| File | Changes |
|---|---|
| `coreza-backend/src/types/order.ts` | **New file** — all types above |
| `coreza-backend/src/services/simBroker/interfaces.ts` | Remove old `OrderSide`, `OrderType`, `OrderStatus`, `OrderRequest`, `Order`, `OrderFill`, `OrderResult`. Re-export from `../../types/order`. Keep `Bar`, `Position`, `Trade`, `EquityPoint`, `PortfolioState`, config, model interfaces. Update `PortfolioState` to use `OrderTicket[]` instead of separate `pendingOrders`/`filledOrders`. |
| `coreza-backend/src/services/simBroker/index.ts` | Create immutable `Order` on submit, append `OrderEvent` on fill, maintain `OrderTicket` aggregate. |
| `coreza-backend/src/services/simBroker/FillModel.ts` | Update param types to `Order` |
| `coreza-backend/src/services/simBroker/SlippageModel.ts` | Same — `Order` |
| `coreza-backend/src/services/simBroker/FeeModel.ts` | Same — `Order`, return `OrderFee` |
| `coreza-backend/src/services/PortfolioManager.ts` | Replace `LiveFill` with `OrderEvent`, `PendingOrder` with `OrderTicket`. |

## Key Decisions

1. **`Order.status`** is the only mutable field — reflects latest event status
2. **`OrderTicket`** replaces both `pendingOrders[]` and `filledOrders[]` — single `tickets: Map<string, OrderTicket>`
3. **`OrderFee` with currency** — enables multi-currency support for crypto
4. **`Trade` type unchanged** — it's a higher-level closed-position concept derived from tickets

