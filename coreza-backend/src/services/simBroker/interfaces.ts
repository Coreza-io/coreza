/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// ============== CONFIGURATION ==============

export interface SimBrokerConfig {
  initialCapital: number;
  fillModel: 'immediate' | 'next_bar_open';
  slippageModel: 'none' | 'fixed' | 'percentage';
  slippageValue: number; // e.g., 0.001 for 0.1% or 0.01 for $0.01 fixed
  commissionModel: 'none' | 'per_share' | 'percentage' | 'fixed';
  commissionValue: number; // e.g., 0.01 for $0.01/share or 0.001 for 0.1%
  allowShort: boolean;
}

export const DEFAULT_SIM_BROKER_CONFIG: SimBrokerConfig = {
  initialCapital: 10000,
  fillModel: 'next_bar_open',
  slippageModel: 'percentage',
  slippageValue: 0.001, // 0.1%
  commissionModel: 'per_share',
  commissionValue: 0.01, // $0.01 per share
  allowShort: false,
};

// ============== MARKET DATA ==============

export interface Bar {
  timestamp: string; // ISO 8601 UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============== ORDERS ==============

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface Order extends OrderRequest {
  id: string;
  status: OrderStatus;
  submittedAt: string; // ISO 8601
  filledQty: number;
  avgFillPrice: number;
  commission: number;
  slippage: number;
  filledAt?: string; // ISO 8601
  barTimestamp?: string; // Which bar triggered the fill
}

export interface OrderFill {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  slippage: number;
  commission: number;
  timestamp: string;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  status?: OrderStatus;
  error?: string;
}

// ============== POSITIONS ==============

export type PositionSide = 'long' | 'short';

export interface Position {
  symbol: string;
  side: PositionSide; // 'long' for positive qty, 'short' for negative qty
  quantity: number; // Positive for long, negative for short
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  marketValue: number;
}

// ============== TRADES (Closed Positions) ==============

export interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
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

export interface PortfolioState {
  cash: number;
  positions: Record<string, Position>; // symbol -> Position
  pendingOrders: Order[];
  filledOrders: Order[];
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
  fill(order: Order, bar: Bar, previousBar?: Bar): FillResult;
}

// ============== SLIPPAGE MODEL ==============

export interface ISlippageModel {
  getSlippage(order: Order, fillPrice: number, bar: Bar): number;
}

// ============== FEE MODEL ==============

export interface IFeeModel {
  getCommission(order: Order, fillPrice: number, fillQty: number): number;
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
