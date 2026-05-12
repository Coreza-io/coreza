/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

// Re-export unified order types (shared with PortfolioManager)
export {
  Order,
  OrderSide,
  OrderType,
  OrderStatus,
  OrderRequest,
  OrderResult,
  OrderEvent,
  OrderFee,
  OrderTicket,
  normalizeOrderType,
  isTicketPending,
} from "../../types/order";

// ============== CONFIGURATION ==============

export interface SimBrokerConfig {
  initialCapital: number;
  expectedBars: number;
  fillModel: "immediate" | "next_bar_open";
  slippageModel: "none" | "fixed" | "percentage";
  slippageValue: number; // e.g., 0.001 for 0.1% or 0.01 for $0.01 fixed
  commissionModel: "none" | "per_share" | "percentage" | "fixed";
  commissionValue: number; // e.g., 0.01 for $0.01/share or 0.001 for 0.1%
  allowShort: boolean;
}

export const DEFAULT_SIM_BROKER_CONFIG: SimBrokerConfig = {
  initialCapital: 10000,
  expectedBars: 10000,
  fillModel: "next_bar_open",
  slippageModel: "percentage",
  slippageValue: 0.001, // 0.1%
  commissionModel: "per_share",
  commissionValue: 0.01, // $0.01 per share
  allowShort: false,
};

// ============== MARKET DATA ==============

export interface Bar {
  timestamp: string | number; // ISO 8601 UTC or epoch milliseconds UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NumericBar {
  timestamp: number; // epoch milliseconds UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============== POSITIONS ==============

export type PositionSide = "long" | "short";

export interface Position {
  symbol: string;
  side: PositionSide; // 'long' for positive qty, 'short' for negative qty
  quantity: number; // Positive for long, negative for short
  avgFillPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marketValue: number;
  openCostBasis: number;
  totalPnl: number;
}

// ============== TRADES (Closed Positions) ==============

export interface Trade {
  id: string;
  symbol: string;
  side: import("../../types/order").OrderSide;
  entryOrderId: string;
  exitOrderId: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  commission: number;
  slippage: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  holdingPeriodBars: number;
}

// ============== PORTFOLIO STATE ==============

export interface EquityPoint {
  timestamp: string;
  cash: number;
  positionsValue: number;
  totalEquity: number;
  drawdownPct: number;
}

export interface NumericEquityPoint {
  timestamp: number;
  cash: number;
  positionsValue: number;
  totalEquity: number;
  drawdownPct: number;
}

export interface PortfolioState {
  cash: number;
  positions: Record<string, Position>; // symbol -> Position
  tickets: Record<string, import("../../types/order").OrderTicket>; // orderId -> OrderTicket
  trades: Trade[]; // Closed trades
  equityCurve: EquityPoint[];
  peakEquity: number;
  currentBar?: Bar;
}

// ============== FILL MODEL ==============

export interface FillResult {
  filled: boolean;
  price?: number;
  quantity?: number;
  reason?: string;
}

export interface IFillModel {
  fill(
    order: import("../../types/order").Order,
    bar: Bar,
    previousBar?: Bar,
  ): FillResult;
}

// ============== SLIPPAGE MODEL ==============

export interface ISlippageModel {
  getSlippage(
    order: import("../../types/order").Order,
    fillPrice: number,
    bar: Bar,
  ): number;
}

// ============== FEE MODEL ==============

export interface IFeeModel {
  getCommission(
    order: import("../../types/order").Order,
    fillPrice: number,
    fillQty: number,
  ): number;
}

// ============== PERFORMANCE METRICS ==============

export interface BacktestMetrics {
  // Returns
  totalReturn: number;
  totalReturnPct: number;
  annualizedReturn: number;

  // Risk
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;

  // Trade Statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;

  // P&L
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgTradePnl: number;

  // Execution
  totalCommission: number;
  totalSlippage: number;

  // Period
  startDate: string;
  endDate: string;
  totalBars: number;
}
