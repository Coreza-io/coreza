/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

// ============== ENUMS ==============

export type OrderSide = "buy" | "sell";

export type OrderType =
  | "market"
  | "limit"
  | "stop_market"
  | "stop_limit"
  | "market_on_open"
  | "market_on_close";

export type OrderStatus =
  | "new"
  | "pending_new"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "expired"
  | "replaced"
  | "rejected"
  | "invalid";

// ============== ORDER (immutable after creation, except status) ==============

export interface Order {
  id: string;
  brokerId?: string[]; // broker-assigned order IDs (live only)
  clientOrderId?: string; // client-assigned order ID sent to broker
  symbol: string;
  quantity: number;
  orderType: OrderType;
  side: OrderSide;
  status: OrderStatus; // latest status (derived from last event)
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
  trailPercent?: number;
  trailPrice?: number;
  createdAt: string; // ISO 8601
  /** Algorithm/event time the order was submitted (epoch ms) — look-ahead protection */
  submittedAt?: number;
  /** Monotonic submission sequence within a run */
  submittedSequence?: number;
  tag?: string; // user-defined label
  properties?: {
    timeInForce?: string;
    extendedHours?: boolean;
  };
}

// ============== ORDER REQUEST (subset for placing orders) ==============

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: string;
  trailPercent?: number;
  trailPrice?: number;
  tag?: string;
  properties?: {
    timeInForce?: string;
    extendedHours?: boolean;
  };
}

// ============== ORDER RESULT ==============

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: OrderStatus;
  error?: string;
}

// ============== ORDER FEE ==============

export interface OrderFee {
  value: number;
  currency: string; // "USD", "USDT", "BNB", etc.
}

// ============== ORDER EVENT (append-only) ==============

export interface OrderEvent {
  orderId: string;
  symbol: string;
  utcTime: string; // ISO 8601
  status: OrderStatus;
  side: OrderSide;
  fillPrice: number;
  fillQuantity: number;
  absoluteFillQuantity?: number;
  orderFee?: OrderFee;
  slippage?: number; // sim only
  message?: string;
  // ---- Simulated-fill provenance (sim only) ----
  /** Symbol of the market data actually used; must equal `symbol` */
  marketDataSymbol?: string;
  marketDataSourceTimestamp?: number;
  marketDataEventTimestamp?: number;
  marketDataAgeMs?: number;
  usedFillForwardData?: boolean;
  fillModel?: string;
  /** Pre-slippage reference price */
  referencePrice?: number;
  rejectionReason?: string;
}

// ============== ORDER TICKET (aggregate) ==============

export interface OrderTicket {
  orderId: string;
  order: Order;
  orderEvents: OrderEvent[];
  quantityFilled: number; // absolute quantity filled for this order
  averageFillPrice: number; // weighted avg
  totalFees: number; // sum of event fees
}

// ============== HELPERS ==============

/**
 * Normalize legacy order type strings to the unified OrderType enum.
 * Maps 'stop' → 'stop_market' for backward compatibility.
 */
export function normalizeOrderType(type: string): OrderType {
  const mapping: Record<string, OrderType> = {
    market: "market",
    limit: "limit",
    stop: "stop_market",
    stop_market: "stop_market",
    stop_limit: "stop_limit",
    market_on_open: "market_on_open",
    market_on_close: "market_on_close",
  };
  return mapping[type] ?? "market";
}

/**
 * Check if an OrderTicket is still pending (not in a terminal state).
 */
export function isTicketPending(ticket: OrderTicket): boolean {
  const s = ticket.order.status;
  return (
    s === "pending_new" ||
    s === "new" ||
    s === "submitted" ||
    s === "partially_filled"
  );
}
