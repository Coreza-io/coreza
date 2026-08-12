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

/**
 * Order-type aware market-data freshness policy.
 * Defaults preserve historic behaviour (no age limits).
 */
export interface MarketDataPolicy {
  /** 0 = no limit */
  maxMarketOrderAgeMs: number;
  /** 0 = no limit */
  maxConditionalOrderAgeMs: number;
  allowFillForwardMarketOrders: boolean;
  requireRealBarForConditionalOrders: boolean;
  rejectOnSymbolMismatch: boolean;
}

export const DEFAULT_MARKET_DATA_POLICY: MarketDataPolicy = {
  maxMarketOrderAgeMs: 0,
  maxConditionalOrderAgeMs: 0,
  allowFillForwardMarketOrders: true,
  requireRealBarForConditionalOrders: false,
  rejectOnSymbolMismatch: true,
};

export type RejectionReason =
  | "NO_MARKET_DATA"
  | "STALE_MARKET_DATA"
  | "MARKET_CLOSED"
  | "SYMBOL_MISMATCH";

export interface SimBrokerConfig {
  initialCapital: number;
  expectedBars: number;
  fillModel: "immediate" | "next_bar_open";
  slippageModel: "none" | "fixed" | "percentage";
  slippageValue: number; // e.g., 0.001 for 0.1% or 0.01 for $0.01 fixed
  commissionModel: "none" | "per_share" | "percentage" | "fixed";
  commissionValue: number; // e.g., 0.01 for $0.01/share or 0.001 for 0.1%
  allowShort: boolean;
  shortMarginRequirement: number;
  marketDataPolicy: MarketDataPolicy;
  /** Allow conditional/next-bar orders to fill from the bar they were submitted on */
  sameBarPolicy: "strict" | "allow-close";
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
  shortMarginRequirement: 1.0,
  marketDataPolicy: DEFAULT_MARKET_DATA_POLICY,
  sameBarPolicy: "strict",
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

/**
 * Canonical symbol-bearing market data unit handed to SimBroker.onBar().
 * Carries both clocks so freshness stays auditable.
 */
export interface MarketBarEnvelope {
  symbol: string;
  bar: Bar;
  /** When the underlying observation actually occurred (epoch ms) */
  sourceTimestamp: number;
  /** Aligned backtest clock currently being processed (epoch ms) */
  eventTimestamp: number;
  isFillForward: boolean;
  intervalMs?: number;
}

export interface RealObservation {
  bar: Bar;
  sourceTimestamp: number;
}

export interface SymbolMarketState {
  latestRealBar: RealObservation | null;
  previousRealBar: RealObservation | null;
  latestEventTimestamp?: number;
  lastFillPrice?: number;
  lastEnvelopeWasFillForward: boolean;
}

/** Market context resolved from the ORDER's own symbol — the only pricing authority. */
export interface ResolvedMarketContext {
  symbol: string;
  bar: Bar | null;
  previousBar: Bar | null;
  sourceTimestamp?: number;
  eventTimestamp?: number;
  ageMs: number;
  isFillForward: boolean;
  lastFillPrice?: number;
}

export interface MarketDataEligibility {
  eligible: boolean;
  /** true => terminal rejection, false => leave pending */
  reject?: boolean;
  reason?: RejectionReason;
  message?: string;
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
  //totalPnl: number;
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
  cumulativeRealizedPnl: number;
  realizedPnlBySymbol: Record<string, number>;
  cumulativeFees: number;
  reservedCash: number;
  reservationsByOrderId: Record<string, number>;
  reservedRateByOrderId: Record<string, number>;
  positions: Record<string, Position>; // symbol -> Position
  tickets: Record<string, import("../../types/order").OrderTicket>; // orderId -> OrderTicket
  trades: Trade[]; // Closed trades
  equityCurve: EquityPoint[];
  peakEquity: number;
  /** @deprecated Symbol-less global bar. Never used for pricing. Removed after migration. */
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
