/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import {
  SimBrokerConfig,
  DEFAULT_SIM_BROKER_CONFIG,
  DEFAULT_MARKET_DATA_POLICY,
  Bar,
  Order,
  OrderRequest,
  OrderEvent,
  OrderTicket,
  Position,
  Trade,
  EquityPoint,
  PortfolioState,
  BacktestMetrics,
  IFillModel,
  ISlippageModel,
  IFeeModel,
  MarketBarEnvelope,
  SymbolMarketState,
  ResolvedMarketContext,
  MarketDataEligibility,
  LiquidationResult,
  RejectionReason,
  normalizeOrderType,
  isTicketPending,
} from "./interfaces";
import { createFillModel } from "./FillModel";
import { createSlippageModel } from "./SlippageModel";
import { createFeeModel } from "./FeeModel";
import { BarBuffer } from "./BarBuffer";

/**
 * SimBroker - In-Memory Simulated Broker for Backtesting
 *
 * High-performance in-memory portfolio state management.
 * All operations are SYNCHRONOUS for maximum speed during bar iteration.
 * No Redis round-trips during backtest execution.
 *
 * Uses the QC Lean pattern: immutable Order + append-only OrderEvent + OrderTicket aggregate.
 * Adjusted price is the actual execution price; slippage is diagnostic and is
 * never deducted from P&L a second time.
 *
 * Performance: 100-500x faster than Redis-based approach
 * - 10 years daily bars (2,520): ~0.1-0.5 seconds
 * - 1 year 1-minute bars (390,000): ~10-30 seconds
 *
 * Usage:
 * 1. Initialize with BacktestInit node (creates in-memory state)
 * 2. Call placeOrder() from BacktestTrade node (synchronous)
 * 3. Call onBar() during each loop iteration to process pending orders (synchronous)
 * 4. Call getMetrics() with BacktestResults node to calculate performance (synchronous)
 */

function asIsoTimestamp(timestamp: string | number): string {
  return typeof timestamp === "number"
    ? new Date(timestamp).toISOString()
    : timestamp;
}

function toEpochMs(timestamp: string | number | undefined): number {
  if (timestamp === undefined) return 0;
  return typeof timestamp === "number"
    ? timestamp
    : new Date(timestamp).getTime();
}

/** Price explicitly carried by a resting order (limit/stop), if any. */
function explicitRestingOrderPrice(
  order: Order | OrderRequest,
): number | undefined {
  switch (normalizeOrderType(order.orderType)) {
    case "limit":
    case "stop_limit":
      return order.limitPrice;
    case "stop_market":
      return order.stopPrice;
    default:
      return undefined;
  }
}

export class SimBroker {
  private backtestId: string;
  private config: SimBrokerConfig;
  private fillModel: IFillModel;
  private slippageModel: ISlippageModel;
  private feeModel: IFeeModel;
  /** Symbol-scoped market data — the ONLY pricing authority. */
  private marketDataBySymbol = new Map<string, SymbolMarketState>();
  /** Migration telemetry for the legacy onBar(symbol, bar) adapter. */
  private legacyOnBarCalls = 0;
  private legacySetCurrentBarCalls = 0;
  private legacySymbolMismatches = 0;
  private envelopeWarnings = new Set<string>();
  private liquidationLocks = new Set<string>();
  private submissionSequence = 0;
  private orderIdCounter = 0;
  private tradeIdCounter = 0;
  private currentEntryMap = new Map<
    string,
    {
      orderId: string;
      filledAt: string;
      barIndex: number;
      entryQuantity: number;
      entryCommission: number;
      entrySlippagePerUnit: number;
    }
  >();
  private pendingTicketsBySymbol = new Map<string, Set<string>>();
  private equityCurveData: {
    timestamps: Float64Array;
    cash: Float64Array;
    positionsValue: Float64Array;
    totalEquity: Float64Array;
    drawdownPct: Float64Array;
  };
  private equityCurveIndex = 0;
  private positionsValue = 0;

  // IN-MEMORY STATE - no Redis!
  private state: PortfolioState;

  constructor(backtestId: string, config: Partial<SimBrokerConfig> = {}) {
    this.backtestId = backtestId;
    this.config = {
      ...DEFAULT_SIM_BROKER_CONFIG,
      ...config,
      marketDataPolicy: {
        ...DEFAULT_MARKET_DATA_POLICY,
        ...(config.marketDataPolicy ?? {}),
      },
    };
    this.fillModel = createFillModel(this.config.fillModel);
    this.slippageModel = createSlippageModel(
      this.config.slippageModel,
      this.config.slippageValue,
    );
    this.feeModel = createFeeModel(
      this.config.commissionModel,
      this.config.commissionValue,
    );

    // Initialize state immediately in memory
    this.state = {
      cash: this.config.initialCapital,
      cumulativeRealizedPnl: 0,
      realizedPnlBySymbol: {},
      cumulativeFees: 0,
      reservedCash: 0,
      reservationsByOrderId: {},
      reservedRateByOrderId: {},
      positions: {},
      tickets: {},
      trades: [],
      equityCurve: [], // kept for PortfolioState interface compat; not used in hot path
      peakEquity: this.config.initialCapital,
    };

    const expectedBars = Math.max(1, this.config.expectedBars);
    this.equityCurveData = {
      timestamps: new Float64Array(expectedBars),
      cash: new Float64Array(expectedBars),
      positionsValue: new Float64Array(expectedBars),
      totalEquity: new Float64Array(expectedBars),
      drawdownPct: new Float64Array(expectedBars),
    };
  }

  // ============== IN-MEMORY STATE MANAGEMENT ==============

  /**
   * Initialize portfolio - SYNCHRONOUS (no Redis)
   * State is already initialized in constructor, this just logs
   */
  initializePortfolio(): void {
    console.log(
      `[SimBroker] Initialized in-memory portfolio for backtest ${this.backtestId} with $${this.config.initialCapital}`,
    );
  }

  /**
   * Get portfolio state - SYNCHRONOUS (direct memory access)
   */
  getPortfolioState(): PortfolioState {
    return this.state;
  }

  // ============== ORDER MANAGEMENT ==============

  /**
   * Place order - SYNCHRONOUS
   * Creates an immutable Order and wraps it in an OrderTicket.
   */
  placeOrder(request: OrderRequest, submittedAt?: number): OrderResult {
    // Validate order
    const validation = this.validateOrder(request, this.state);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const orderId = `SIM-${++this.orderIdCounter}`;
    const submissionTime =
      submittedAt ??
      this.marketDataBySymbol.get(request.symbol)?.latestEventTimestamp ??
      0;

    // Create immutable Order
    const order: Order = {
      id: orderId,
      symbol: request.symbol,
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      tag: request.tag,
      properties: request.properties,
      status: "new",
      createdAt: new Date().toISOString(),
      submittedAt: submissionTime,
      submittedSequence: ++this.submissionSequence,
    };

    // Create OrderTicket aggregate
    const ticket: OrderTicket = {
      orderId,
      order,
      orderEvents: [],
      quantityFilled: 0,
      averageFillPrice: 0,
      totalFees: 0,
    };

    this.state.tickets[orderId] = ticket;
    this.reserveBuyingPower(order);
    this.trackPendingTicket(order.symbol, orderId);

    return { success: true, orderId, status: "new" };
  }

  cancelOrder(orderId: string): boolean {
    return this.transitionPendingOrder(orderId, "canceled");
  }

  rejectOrder(orderId: string): boolean {
    return this.transitionPendingOrder(orderId, "rejected");
  }

  expireOrder(orderId: string): boolean {
    return this.transitionPendingOrder(orderId, "expired");
  }

  markOrderReplaced(orderId: string): boolean {
    return this.transitionPendingOrder(orderId, "replaced");
  }

  private transitionPendingOrder(
    orderId: string,
    status: "canceled" | "rejected" | "expired" | "replaced",
  ): boolean {
    const ticket = this.state.tickets[orderId];
    if (!ticket || !isTicketPending(ticket)) return false;
    ticket.order.status = status;
    this.untrackPendingTicket(ticket.order.symbol, orderId);
    this.releaseBuyingPower(orderId);
    return true;
  }

  private ensureEquityCapacity(): void {
    if (this.equityCurveIndex < this.equityCurveData.timestamps.length) {
      return;
    }

    const current = this.equityCurveData.timestamps.length;
    const next = Math.max(1, current * 2);
    const grow = (arr: Float64Array) => {
      const n = new Float64Array(next);
      n.set(arr);
      return n;
    };

    this.equityCurveData = {
      timestamps: grow(this.equityCurveData.timestamps),
      cash: grow(this.equityCurveData.cash),
      positionsValue: grow(this.equityCurveData.positionsValue),
      totalEquity: grow(this.equityCurveData.totalEquity),
      drawdownPct: grow(this.equityCurveData.drawdownPct),
    };
  }

  private recordEquityPoint(
    timestamp: string | number,
    cash: number,
    positionsValue: number,
    totalEquity: number,
    drawdownPct: number,
  ): void {
    this.ensureEquityCapacity();
    const idx = this.equityCurveIndex++;
    this.equityCurveData.timestamps[idx] = BarBuffer.toEpochMs(timestamp);
    this.equityCurveData.cash[idx] = cash;
    this.equityCurveData.positionsValue[idx] = positionsValue;
    this.equityCurveData.totalEquity[idx] = totalEquity;
    this.equityCurveData.drawdownPct[idx] = drawdownPct;

    // TypedArrays are the primary store — no object array push
  }

  private validateOrder(
    request: OrderRequest,
    state: PortfolioState,
  ): { valid: boolean; error?: string } {
    // Check quantity
    if (request.quantity <= 0) {
      return { valid: false, error: "Quantity must be positive" };
    }

    // Check limit/stop prices
    if (request.orderType === "limit" && !request.limitPrice) {
      return { valid: false, error: "Limit price required for limit orders" };
    }
    if (request.orderType === "stop_market" && !request.stopPrice) {
      return { valid: false, error: "Stop price required for stop orders" };
    }
    if (
      request.orderType === "stop_limit" &&
      (!request.stopPrice || !request.limitPrice)
    ) {
      return {
        valid: false,
        error: "Both stop and limit prices required for stop-limit orders",
      };
    }

    const estimatedPrice = this.estimateOrderPrice(request);
    if (!Number.isFinite(estimatedPrice) || estimatedPrice <= 0) {
      return {
        valid: false,
        error: `NO_MARKET_DATA: No market price available for ${request.symbol}`,
      };
    }

    // Check for short selling
    if (request.side === "sell" && !this.config.allowShort) {
      const position = state.positions[request.symbol];
      const currentQty = position?.quantity ?? 0;

      if (request.quantity > currentQty) {
        return {
          valid: false,
          error: `Cannot sell ${request.quantity} shares. Only ${currentQty} shares held. Short selling disabled.`,
        };
      }
    }

    const requiredBuyingPower = this.computeReservation(request);
    if (requiredBuyingPower > this.availableBuyingPower) {
      return {
        valid: false,
        error: `Insufficient buying power. Required: $${requiredBuyingPower.toFixed(2)}, Available: $${this.availableBuyingPower.toFixed(2)}`,
      };
    }

    return { valid: true };
  }

  // ============== BAR PROCESSING ==============

  private validateEnvelope(envelope: MarketBarEnvelope): string | null {
    if (typeof envelope.symbol !== "string" || envelope.symbol.trim() === "") {
      return "symbol must be non-empty";
    }
    if (!envelope.bar) return `${envelope.symbol}: bar is required`;
    for (const field of ["open", "high", "low", "close"] as const) {
      if (!Number.isFinite(envelope.bar[field])) {
        return `${envelope.symbol}: bar.${field} must be finite`;
      }
    }
    if (
      !Number.isFinite(envelope.sourceTimestamp) ||
      envelope.sourceTimestamp <= 0
    ) {
      return `${envelope.symbol}: sourceTimestamp must be finite and positive`;
    }
    if (
      !Number.isFinite(envelope.eventTimestamp) ||
      envelope.eventTimestamp <= 0
    ) {
      return `${envelope.symbol}: eventTimestamp must be finite and positive`;
    }
    if (envelope.sourceTimestamp > envelope.eventTimestamp) {
      return `${envelope.symbol}: sourceTimestamp exceeds eventTimestamp`;
    }
    const latestEventTimestamp = this.marketDataBySymbol.get(
      envelope.symbol,
    )?.latestEventTimestamp;
    if (
      latestEventTimestamp !== undefined &&
      envelope.eventTimestamp < latestEventTimestamp
    ) {
      return `${envelope.symbol}: eventTimestamp precedes latest event timestamp`;
    }
    return null;
  }

  private isCausallyEligible(
    order: Order,
    context: ResolvedMarketContext,
  ): boolean {
    const orderType = normalizeOrderType(order.orderType);
    const requiresLaterObservation =
      this.config.fillModel === "next_bar_open" ||
      orderType === "limit" ||
      orderType === "stop_market" ||
      orderType === "stop_limit";
    if (!requiresLaterObservation) return context.bar !== null;
    if (
      context.sourceTimestamp === undefined ||
      order.submittedAt === undefined
    ) {
      return false;
    }
    return this.config.sameBarPolicy === "allow-close"
      ? context.sourceTimestamp >= order.submittedAt
      : context.sourceTimestamp > order.submittedAt;
  }

  /**
   * @deprecated Global current-bar pricing is removed. Callers must not
   * select market data; SimBroker resolves it per order symbol.
   */
  setCurrentBar(_bar: Bar): void {
    this.legacySetCurrentBarCalls++;
    if (process.env.NODE_ENV === "test") {
      throw new Error(
        "SimBroker.setCurrentBar is removed: market data is symbol-scoped",
      );
    }
    console.warn(
      "[SimBroker] setCurrentBar() is deprecated and ignored (symbol-scoped pricing).",
    );
  }

  /**
   * Process a market data envelope for ONE symbol - SYNCHRONOUS.
   * Updates that symbol's state, then attempts fills for its pending tickets
   * using the canonical resolved context.
   */
  onBar(envelope: MarketBarEnvelope): OrderEvent[];
  /** @deprecated legacy positional signature */
  onBar(symbol: string, bar: Bar): OrderEvent[];
  onBar(
    envelopeOrSymbol: MarketBarEnvelope | string,
    legacyBar?: Bar,
  ): OrderEvent[] {
    let envelope: MarketBarEnvelope;
    if (typeof envelopeOrSymbol === "string") {
      this.legacyOnBarCalls++;
      const bar = legacyBar as Bar;
      const symbolBearingBar = bar as Bar & { symbol?: unknown; Symbol?: unknown };
      const embeddedSymbol = symbolBearingBar?.symbol ?? symbolBearingBar?.Symbol;
      if (embeddedSymbol !== undefined && embeddedSymbol !== envelopeOrSymbol) {
        this.legacySymbolMismatches++;
        const message = `Legacy onBar symbol mismatch: argument ${envelopeOrSymbol} does not match bar symbol ${String(embeddedSymbol)}`;
        if (process.env.NODE_ENV === "test") throw new Error(message);
        console.warn(`[SimBroker] ${message}`);
      }
      envelope = {
        symbol: envelopeOrSymbol,
        bar,
        sourceTimestamp: toEpochMs(bar?.timestamp),
        eventTimestamp: toEpochMs(bar?.timestamp),
        isFillForward: false,
      };
    } else {
      envelope = envelopeOrSymbol;
    }

    const validationError = this.validateEnvelope(envelope);
    if (validationError) {
      if (process.env.NODE_ENV === "test") throw new Error(validationError);
      const warningKey = `${envelope.symbol}:${validationError}`;
      if (!this.envelopeWarnings.has(warningKey)) {
        this.envelopeWarnings.add(warningKey);
        console.warn(`[SimBroker] Ignoring invalid market envelope: ${validationError}`);
      }
      return [];
    }

    const { symbol, bar } = envelope;
    const events: OrderEvent[] = [];
    const marketState = this.getMarketStateForUpdate(symbol);

    // ---- Ingest: real observation vs fill-forward event ----
    marketState.latestEventTimestamp = envelope.eventTimestamp;
    marketState.lastEnvelopeWasFillForward = envelope.isFillForward === true;
    if (!envelope.isFillForward) {
      marketState.previousRealBar = marketState.latestRealBar;
      marketState.latestRealBar = {
        bar,
        sourceTimestamp: envelope.sourceTimestamp,
        eventTimestamp: envelope.eventTimestamp,
      };
    } else if (marketState.latestRealBar) {
      // Keep the original source timestamp; only the event clock advances.
      marketState.latestRealBar = {
        ...marketState.latestRealBar,
        eventTimestamp: envelope.eventTimestamp,
      };
    }

    const context = this.resolveMarketContext({ symbol } as Order);

    // Process pending tickets for this symbol only
    const pendingTickets = this.pendingTicketsBySymbol.get(symbol);
    if (pendingTickets) {
      for (const ticketId of [...pendingTickets]) {
        const ticket = this.state.tickets[ticketId];
        if (!ticket || !isTicketPending(ticket)) {
          pendingTickets.delete(ticketId);
          this.releaseBuyingPower(ticketId);
          continue;
        }

        const order = ticket.order;
        const remainingQuantity = order.quantity - ticket.quantityFilled;
        if (remainingQuantity <= 0) {
          order.status = "filled";
          pendingTickets.delete(ticketId);
          this.releaseBuyingPower(order.id);
          continue;
        }

        if (!this.isCausallyEligible(order, context)) continue;

        const eligibility = this.classifyMarketData(order, context);
        if (!eligibility.eligible) {
          const rejectEvent = this.applyEligibilityTransition(
            ticket,
            context,
            eligibility,
          );
          if (rejectEvent) events.push(rejectEvent);
          continue;
        }

        const event = this.fillTicket(ticket, context, remainingQuantity);
        if (event) events.push(event);
      }
      if (pendingTickets.size === 0) {
        this.pendingTicketsBySymbol.delete(symbol);
      }
    }

    // Update position mark-to-market for THIS symbol only
    this.updatePositionMTM(symbol, bar.close);

    return events;
  }

  /**
   * LEAN-style liquidation for a single symbol.
   * Submits a market order for -(holdingQty + signed pending market qty),
   * so in-flight market orders are neutralized rather than double-counted.
   */
  liquidate(
    symbol: string,
    tag = "Liquidate",
  ): LiquidationResult {
    const canceledOrderIds: string[] = [];
    if (this.liquidationLocks.has(symbol)) {
      return {
        success: true,
        skipped: true,
        reason: "LIQUIDATION_IN_FLIGHT",
        canceledOrderIds,
      };
    }

    this.liquidationLocks.add(symbol);
    try {
      const pendingIds = this.pendingTicketsBySymbol.get(symbol);
      if (pendingIds) {
        for (const id of [...pendingIds]) {
          const ticket = this.state.tickets[id];
          if (
            ticket &&
            isTicketPending(ticket) &&
            normalizeOrderType(ticket.order.orderType) !== "market" &&
            this.cancelOrder(id)
          ) {
            canceledOrderIds.push(id);
          }
        }
      }

      const holdingQty = this.state.positions[symbol]?.quantity ?? 0;
      let pendingMarketQty = 0;
      for (const id of this.pendingTicketsBySymbol.get(symbol) ?? []) {
        const ticket = this.state.tickets[id];
        if (!ticket || !isTicketPending(ticket)) continue;
        if (normalizeOrderType(ticket.order.orderType) !== "market") continue;
        const remaining = ticket.order.quantity - ticket.quantityFilled;
        if (remaining <= 0) continue;
        pendingMarketQty += ticket.order.side === "sell" ? -remaining : remaining;
      }

      const target = -(holdingQty + pendingMarketQty);
      if (target === 0) {
        return {
          success: true,
          skipped: true,
          reason: "NOTHING_TO_LIQUIDATE",
          canceledOrderIds,
        };
      }

      const result = this.placeOrder({
        symbol,
        side: target > 0 ? "buy" : "sell",
        orderType: "market",
        quantity: Math.abs(target),
        tag,
      });
      if (!result.success || !result.orderId || !result.status) {
        return {
          success: false,
          error: result.error ?? "Liquidation order was not accepted",
          canceledOrderIds,
        };
      }
      const fill =
        this.config.fillModel === "immediate"
          ? this.tryFillImmediateOrder(result.orderId)
          : null;
      return {
        success: true,
        orderId: result.orderId,
        status: result.status,
        canceledOrderIds,
        fill,
      };
    } finally {
      this.liquidationLocks.delete(symbol);
    }
  }


  recordEquitySnapshot(timestamp: string | number): void {
    const positionsValue = this.positionsValue;
    const currentEquity = this.state.cash + positionsValue;

    if (currentEquity > this.state.peakEquity) {
      this.state.peakEquity = currentEquity;
    }
    const drawdownPct =
      this.state.peakEquity > 0
        ? ((this.state.peakEquity - currentEquity) / this.state.peakEquity) *
          100
        : 0;

    this.recordEquityPoint(
      timestamp,
      this.state.cash,
      positionsValue,
      currentEquity,
      drawdownPct,
    );
  }

  /**
   * Attempt to fill a specific pending order using ITS OWN symbol's market data.
   * Used for the immediate fill model only (same-bar execution).
   * The caller can never select the bar — pricing authority lives here.
   *
   * @param legacyBar deprecated; ignored (kept for one migration cycle)
   */
  tryFillImmediateOrder(orderId: string, legacyBar?: Bar): OrderEvent | null {
    if (legacyBar !== undefined) {
      this.legacyOnBarCalls++;
      if (process.env.NODE_ENV === "test") {
        throw new Error(
          "tryFillImmediateOrder(orderId, bar) is removed: market data is resolved from order.symbol",
        );
      }
      console.warn(
        "[SimBroker] tryFillImmediateOrder received a caller-supplied bar; it is ignored.",
      );
    }

    if (this.config.fillModel !== "immediate") {
      return null;
    }

    const ticket = this.state.tickets[orderId];
    if (!ticket || !isTicketPending(ticket)) {
      return null;
    }

    const order = ticket.order;
    const remainingQuantity = order.quantity - ticket.quantityFilled;
    if (remainingQuantity <= 0) {
      order.status = "filled";
      this.untrackPendingTicket(order.symbol, order.id);
      this.releaseBuyingPower(order.id);
      return null;
    }

    const context = this.resolveMarketContext(order);
    if (!this.isCausallyEligible(order, context)) return null;
    const eligibility = this.classifyMarketData(order, context);
    if (!eligibility.eligible) {
      return this.applyEligibilityTransition(ticket, context, eligibility);
    }

    return this.fillTicket(ticket, context, remainingQuantity);
  }

  /**
   * Resolve the market context for an order STRICTLY from order.symbol.
   * This is the single boundary through which market data enters
   * validation, reservation, fills, slippage and fees.
   */
  resolveMarketContext(order: Order | OrderRequest): ResolvedMarketContext {
    const state = this.marketDataBySymbol.get(order.symbol);
    const sourceTimestamp = state?.latestRealBar?.sourceTimestamp;
    const eventTimestamp = state?.latestEventTimestamp;
    const ageMs =
      sourceTimestamp !== undefined && eventTimestamp !== undefined
        ? Math.max(0, eventTimestamp - sourceTimestamp)
        : 0;

    return {
      symbol: order.symbol,
      bar: state?.latestRealBar?.bar ?? null,
      previousBar: state?.previousRealBar?.bar ?? null,
      sourceTimestamp,
      eventTimestamp,
      ageMs,
      isFillForward: state?.lastEnvelopeWasFillForward ?? false,
      lastFillPrice: state?.lastFillPrice,
    };
  }

  /**
   * Pure classifier — never mutates state.
   * Applies order-type specific freshness rules from the configured policy.
   */
  classifyMarketData(
    order: Order,
    context: ResolvedMarketContext,
  ): MarketDataEligibility {
    if (order.symbol !== context.symbol) {
      return {
        eligible: false,
        reject: true,
        reason: "SYMBOL_MISMATCH",
        message: `Market data symbol ${context.symbol} does not match order symbol ${order.symbol}`,
      };
    }

    if (!context.bar) {
      const explicitPrice = explicitRestingOrderPrice(order);
      // Explicitly priced resting orders may wait for their symbol's data.
      return {
        eligible: false,
        reject: explicitPrice === undefined,
        reason: "NO_MARKET_DATA",
        message: `No market data available for ${order.symbol}`,
      };
    }

    const policy = this.config.marketDataPolicy;
    const isMarketOrder =
      normalizeOrderType(order.orderType) === "market" ||
      normalizeOrderType(order.orderType) === "market_on_open" ||
      normalizeOrderType(order.orderType) === "market_on_close";

    if (isMarketOrder) {
      if (context.isFillForward && !policy.allowFillForwardMarketOrders) {
        return {
          eligible: false,
          reason: "STALE_MARKET_DATA",
          message: `Fill-forward data not allowed for market orders on ${order.symbol}`,
        };
      }
      if (
        policy.maxMarketOrderAgeMs > 0 &&
        context.ageMs > policy.maxMarketOrderAgeMs
      ) {
        return {
          eligible: false,
          reject: true,
          reason: "STALE_MARKET_DATA",
          message: `Market data for ${order.symbol} is ${context.ageMs}ms old`,
        };
      }
      return { eligible: true };
    }

    if (context.isFillForward && policy.requireRealBarForConditionalOrders) {
      return {
        eligible: false,
        reason: "STALE_MARKET_DATA",
        message: `Conditional order on ${order.symbol} requires a real bar`,
      };
    }
    if (
      policy.maxConditionalOrderAgeMs > 0 &&
      context.ageMs > policy.maxConditionalOrderAgeMs
    ) {
      return {
        eligible: false,
        reason: "STALE_MARKET_DATA",
        message: `Market data for ${order.symbol} is ${context.ageMs}ms old`,
      };
    }

    return { eligible: true };
  }

  /**
   * Atomic transition for an ineligible ticket:
   * terminal status + reason, pending-index removal, reservation release, OrderEvent.
   * Non-terminal outcomes leave the ticket pending untouched.
   */
  private applyEligibilityTransition(
    ticket: OrderTicket,
    context: ResolvedMarketContext,
    eligibility: MarketDataEligibility,
  ): OrderEvent | null {
    if (!eligibility.reject) {
      return null; // stays pending
    }

    const order = ticket.order;
    order.status = "rejected";
    this.untrackPendingTicket(order.symbol, order.id);
    this.releaseBuyingPower(order.id);

    const event: OrderEvent = {
      orderId: order.id,
      symbol: order.symbol,
      utcTime: new Date(
        context.eventTimestamp ?? Date.now(),
      ).toISOString(),
      status: "rejected",
      side: order.side,
      fillPrice: 0,
      fillQuantity: 0,
      absoluteFillQuantity: 0,
      message: eligibility.message,
      rejectionReason: eligibility.reason as RejectionReason,
      marketDataSymbol: context.symbol,
      marketDataSourceTimestamp: context.sourceTimestamp,
      marketDataEventTimestamp: context.eventTimestamp,
      marketDataAgeMs: context.ageMs,
      usedFillForwardData: context.isFillForward,
      fillModel: this.config.fillModel,
    };
    ticket.orderEvents.push(event);
    return event;
  }

  /**
   * Execute a fill for a pending ticket against its own symbol's market context.
   */
  private fillTicket(
    ticket: OrderTicket,
    context: ResolvedMarketContext,
    remainingQuantity: number,
  ): OrderEvent | null {
    const bar = context.bar;
    if (!bar) return null;

    const order = ticket.order;
    const fillOrder: Order = { ...order, quantity: remainingQuantity };
    const fillResult = this.fillModel.fill(
      fillOrder,
      bar,
      context.previousBar ?? undefined,
    );

    if (
      !fillResult.filled ||
      fillResult.price === undefined ||
      !Number.isFinite(fillResult.price) ||
      fillResult.price <= 0 ||
      fillResult.quantity === undefined ||
      !Number.isFinite(fillResult.quantity) ||
      fillResult.quantity <= 0
    ) {
      return null;
    }

    const fillQuantity = Math.min(fillResult.quantity, remainingQuantity);
    const slippage = this.slippageModel.getSlippage(
      fillOrder,
      fillResult.price,
      bar,
    );
    const adjustedPrice = fillResult.price + slippage;
    const commission = this.feeModel.getCommission(
      fillOrder,
      adjustedPrice,
      fillQuantity,
    );

    this.applyFill(
      order,
      adjustedPrice,
      fillQuantity,
      slippage,
      commission,
      bar.timestamp,
    );

    const eventStatus = this.aggregateTicketFill(
      ticket,
      adjustedPrice,
      fillQuantity,
      commission,
    );

    const event: OrderEvent = {
      orderId: order.id,
      symbol: order.symbol,
      utcTime: asIsoTimestamp(bar.timestamp),
      status: eventStatus,
      side: order.side,
      fillPrice: adjustedPrice,
      fillQuantity: order.side === "sell" ? -fillQuantity : fillQuantity,
      absoluteFillQuantity: fillQuantity,
      orderFee: { value: commission, currency: "USD" },
      slippage,
      // per-fill provenance (also snapshotted for each partial fill)
      marketDataSymbol: context.symbol,
      marketDataSourceTimestamp: context.sourceTimestamp,
      marketDataEventTimestamp: context.eventTimestamp,
      marketDataAgeMs: context.ageMs,
      usedFillForwardData: context.isFillForward,
      fillModel: this.config.fillModel,
      referencePrice: fillResult.price,
    };

    ticket.orderEvents.push(event);
    this.getMarketStateForUpdate(order.symbol).lastFillPrice = adjustedPrice;

    if (!isTicketPending(ticket)) {
      this.untrackPendingTicket(order.symbol, order.id);
      this.releaseBuyingPower(order.id);
    } else {
      this.adjustBuyingPowerReservation(ticket);
    }

    this.updatePositionMTM(order.symbol, bar.close);

    return event;
  }


  private applyFill(
    order: Order,
    price: number,
    quantity: number,
    slippage: number,
    commission: number,
    timestamp: string | number,
  ): void {
    const signedQuantity = order.side === "buy" ? quantity : -quantity;

    if (order.side === "buy") {
      this.state.cash -= price * quantity + commission;
    } else {
      this.state.cash += price * quantity - commission;
    }
    this.state.cumulativeFees += commission;

    const existing = this.state.positions[order.symbol];
    if (!existing) {
      const marketValue = signedQuantity * price;
      this.state.positions[order.symbol] = {
        symbol: order.symbol,
        side: signedQuantity >= 0 ? "long" : "short",
        quantity: signedQuantity,
        avgFillPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: 0,
        marketValue,
        openCostBasis: Math.abs(signedQuantity) * price,
      };
      this.positionsValue += marketValue;
      this.currentEntryMap.set(order.symbol, {
        orderId: order.id,
        filledAt: asIsoTimestamp(timestamp),
        barIndex: this.equityCurveIndex,
        entryQuantity: Math.abs(signedQuantity),
        entryCommission: commission,
        entrySlippagePerUnit: Math.abs(slippage),
      });
      return;
    }

    const existingQty = existing.quantity;
    const oldMarketValue = existing.marketValue;
    const sameDirection =
      (existingQty >= 0 && signedQuantity >= 0) ||
      (existingQty <= 0 && signedQuantity <= 0);

    if (sameDirection) {
      const entry = this.currentEntryMap.get(order.symbol);
      const existingEntryQuantity = Math.max(0, entry?.entryQuantity ?? 0);
      const addedQuantity = Math.abs(signedQuantity);
      const updatedEntryQuantity = existingEntryQuantity + addedQuantity;
      const updatedEntryCommission = (entry?.entryCommission ?? 0) + commission;
      const updatedEntrySlippagePerUnit =
        updatedEntryQuantity > 0
          ? ((entry?.entrySlippagePerUnit ?? 0) * existingEntryQuantity +
              Math.abs(slippage) * addedQuantity) /
            updatedEntryQuantity
          : 0;

      const totalQty = existingQty + signedQuantity;
      const totalCostBasis =
        existing.avgFillPrice * Math.abs(existingQty) +
        price * Math.abs(signedQuantity);
      existing.avgFillPrice = totalCostBasis / Math.abs(totalQty);
      existing.quantity = totalQty;
      existing.side = totalQty >= 0 ? "long" : "short";
      existing.currentPrice = price;
      existing.marketValue = totalQty * price;
      existing.openCostBasis = Math.abs(totalQty) * existing.avgFillPrice;
      existing.unrealizedPnl = (price - existing.avgFillPrice) * totalQty;
      this.positionsValue += existing.marketValue - oldMarketValue;
      this.currentEntryMap.set(order.symbol, {
        orderId: entry?.orderId ?? order.id,
        filledAt: entry?.filledAt ?? asIsoTimestamp(timestamp),
        barIndex: entry?.barIndex ?? this.equityCurveIndex,
        entryQuantity: updatedEntryQuantity,
        entryCommission: updatedEntryCommission,
        entrySlippagePerUnit: updatedEntrySlippagePerUnit,
      });
      return;
    }

    const closingQty = Math.min(
      Math.abs(existingQty),
      Math.abs(signedQuantity),
    );
    const isClosingLong = existingQty > 0;
    const grossPnl = isClosingLong
      ? (price - existing.avgFillPrice) * closingQty
      : (existing.avgFillPrice - price) * closingQty;
    const exitCommission = commission * (closingQty / Math.abs(signedQuantity));
    const exitSlippageCost = Math.abs(slippage) * closingQty;
    const fillTimeIso = asIsoTimestamp(timestamp);
    const entry = this.currentEntryMap.get(order.symbol);
    const entryOrderId = entry?.orderId ?? order.id;
    const entryTime = entry?.filledAt ?? fillTimeIso;
    const entryQuantity = Math.max(1, entry?.entryQuantity ?? closingQty);
    const entryFraction = closingQty / entryQuantity;
    const allocatedEntryCommission =
      (entry?.entryCommission ?? 0) * entryFraction;
    const entrySlippagePerUnit = entry?.entrySlippagePerUnit ?? 0;
    const allocatedEntrySlippageCost = entrySlippagePerUnit * closingQty;
    const totalCommissionForTrade = allocatedEntryCommission + exitCommission;
    const totalSlippageForTrade = allocatedEntrySlippageCost + exitSlippageCost;
    const netPnl = grossPnl - totalCommissionForTrade;
    const holdingPeriodBars = Math.max(
      0,
      this.equityCurveIndex - (entry?.barIndex ?? this.equityCurveIndex),
    );

    existing.realizedPnl += netPnl;
    this.state.cumulativeRealizedPnl += netPnl;
    this.state.realizedPnlBySymbol[order.symbol] =
      (this.state.realizedPnlBySymbol[order.symbol] ?? 0) + netPnl;

    const trade: Trade = {
      id: `TRD-${++this.tradeIdCounter}`,
      symbol: order.symbol,
      side: isClosingLong ? "buy" : "sell",
      entryOrderId,
      exitOrderId: order.id,
      entryPrice: existing.avgFillPrice,
      exitPrice: price,
      quantity: closingQty,
      grossPnl,
      commission: totalCommissionForTrade,
      slippage: totalSlippageForTrade,
      netPnl,
      entryTime,
      exitTime: fillTimeIso,
      holdingPeriodBars,
    };
    this.state.trades.push(trade);

    const newQty = existingQty + signedQuantity;
    if (newQty === 0) {
      this.positionsValue -= oldMarketValue;
      delete this.state.positions[order.symbol];
      this.currentEntryMap.delete(order.symbol);
      return;
    }

    if ((existingQty > 0 && newQty > 0) || (existingQty < 0 && newQty < 0)) {
      existing.quantity = newQty;
      existing.side = newQty >= 0 ? "long" : "short";
      existing.currentPrice = price;
      existing.marketValue = newQty * price;
      existing.openCostBasis = Math.abs(newQty) * existing.avgFillPrice;
      existing.unrealizedPnl = (price - existing.avgFillPrice) * newQty;
      this.positionsValue += existing.marketValue - oldMarketValue;
      const remainingEntryQuantity = Math.max(0, entryQuantity - closingQty);
      if (entry && remainingEntryQuantity > 0) {
        this.currentEntryMap.set(order.symbol, {
          ...entry,
          entryQuantity: remainingEntryQuantity,
          entryCommission: Math.max(
            0,
            (entry.entryCommission ?? 0) - allocatedEntryCommission,
          ),
        });
      }
      return;
    }

    // Position flipped direction on this fill; reset cost basis at fill price
    existing.quantity = newQty;
    existing.side = newQty >= 0 ? "long" : "short";
    existing.avgFillPrice = price;
    existing.currentPrice = price;
    existing.marketValue = newQty * price;
    existing.openCostBasis = Math.abs(newQty) * existing.avgFillPrice;
    existing.unrealizedPnl = 0;
    this.positionsValue += existing.marketValue - oldMarketValue;
    this.currentEntryMap.set(order.symbol, {
      orderId: order.id,
      filledAt: fillTimeIso,
      barIndex: this.equityCurveIndex,
      entryQuantity: Math.abs(newQty),
      entryCommission:
        commission * (Math.abs(newQty) / Math.abs(signedQuantity)),
      entrySlippagePerUnit: Math.abs(slippage),
    });
  }

  updatePositionMTM(symbol: string, currentPrice: number): void {
    const position = this.state.positions[symbol];
    if (position) {
      const oldMarketValue = position.marketValue;
      position.currentPrice = currentPrice;
      position.marketValue = position.quantity * currentPrice;
      position.unrealizedPnl =
        (currentPrice - position.avgFillPrice) * position.quantity;
      this.positionsValue += position.marketValue - oldMarketValue;
    }
  }

  private aggregateTicketFill(
    ticket: OrderTicket,
    fillPrice: number,
    fillQuantity: number,
    fee: number,
  ): OrderEvent["status"] {
    const previousQuantityFilled = ticket.quantityFilled;
    const newQuantityFilled = previousQuantityFilled + fillQuantity;
    ticket.averageFillPrice =
      (ticket.averageFillPrice * previousQuantityFilled +
        fillPrice * fillQuantity) /
      newQuantityFilled;
    ticket.quantityFilled = newQuantityFilled;
    ticket.totalFees += fee;
    ticket.order.status =
      newQuantityFilled >= ticket.order.quantity
        ? "filled"
        : "partially_filled";
    return ticket.order.status;
  }

  private reserveBuyingPower(order: Order): void {
    const reservation = this.computeReservation(order);
    this.state.reservationsByOrderId[order.id] = reservation;
    this.state.reservedRateByOrderId[order.id] =
      reservation / order.quantity;
    this.recomputeReservedCash();
  }

  private adjustBuyingPowerReservation(ticket: OrderTicket): void {
    const reservedRate = this.state.reservedRateByOrderId[ticket.orderId];
    if (reservedRate === undefined) return;
    const remainingQuantity = Math.max(
      0,
      ticket.order.quantity - ticket.quantityFilled,
    );
    this.state.reservationsByOrderId[ticket.orderId] =
      reservedRate * remainingQuantity;
    this.recomputeReservedCash();
  }

  private releaseBuyingPower(orderId: string): void {
    delete this.state.reservationsByOrderId[orderId];
    delete this.state.reservedRateByOrderId[orderId];
    this.recomputeReservedCash();
  }

  private estimateOrderPrice(order: Order | OrderRequest): number {
    const context = this.resolveMarketContext(order);
    const lastClose = context.bar?.close ?? context.previousBar?.close;
    let orderPrice: number | undefined;

    switch (normalizeOrderType(order.orderType)) {
      case "limit":
      case "stop_limit":
        orderPrice = order.limitPrice;
        break;
      case "stop_market":
        orderPrice = order.stopPrice;
        break;
      case "market":
      case "market_on_open":
      case "market_on_close":
        orderPrice = lastClose;
        break;
    }

    if (orderPrice !== undefined && lastClose !== undefined) {
      return order.side === "buy"
        ? Math.max(orderPrice, lastClose)
        : Math.min(orderPrice, lastClose);
    }

    // NOTE: no global currentBar fallback — pricing is symbol-scoped only.
    return orderPrice ?? lastClose ?? context.lastFillPrice ?? 0;
  }

  private computeReservation(order: Order | OrderRequest): number {
    const price = this.estimateOrderPrice(order);
    if (!Number.isFinite(price) || price <= 0) return 0;

    const positionQuantity = this.state.positions[order.symbol]?.quantity ?? 0;
    const reservedQuantity =
      order.side === "buy"
        ? order.quantity
        : Math.max(0, order.quantity - Math.max(0, positionQuantity));
    if (reservedQuantity === 0) return 0;

    const reservationOrder: Order =
      "id" in order
        ? order
        : {
            ...order,
            id: "estimate",
            status: "new",
            createdAt: "",
          };
    const totalFee = this.feeModel.getCommission(
      reservationOrder,
      price,
      order.quantity,
    );
    const feeShare = totalFee * (reservedQuantity / order.quantity);
    const marginRequirement =
      order.side === "sell" ? this.config.shortMarginRequirement : 1;
    return price * reservedQuantity * marginRequirement + feeShare;
  }

  private get availableBuyingPower(): number {
    return this.state.cash - this.state.reservedCash;
  }

  public getAvailableBuyingPower(): number {
    return this.availableBuyingPower;
  }

  private recomputeReservedCash(): void {
    this.state.reservedCash = Object.values(
      this.state.reservationsByOrderId,
    ).reduce((total, reservation) => total + reservation, 0);
  }

  public releaseAllReservations(): void {
    this.state.reservationsByOrderId = {};
    this.state.reservedRateByOrderId = {};
    this.recomputeReservedCash();
  }

  /**
   * Bulk mark-to-market update for all held positions.
   * Called by engine before strategy code runs each bar.
   */
  updateAllPositionsMTM(prices: Record<string, number>): void {
    for (const [symbol, price] of Object.entries(prices)) {
      this.updatePositionMTM(symbol, price);
    }
  }

  /**
   * Get a single position by symbol, or null if not held.
   */
  getPosition(symbol: string): Position | null {
    return this.state.positions[symbol] || null;
  }

  // ============== SNAPSHOT & EQUITY ==============

  // ============== METRICS CALCULATION ==============

  /**
   * Get metrics - SYNCHRONOUS (no Redis)
   */
  getMetrics(): BacktestMetrics {
    const trades = this.state.trades;
    const initialCapital = this.config.initialCapital;
    const ecIdx = this.equityCurveIndex;
    const ecData = this.equityCurveData;

    // Equity from TypedArrays (no object array)
    const lastIdx = ecIdx - 1;
    const finalEquity =
      lastIdx >= 0 ? ecData.totalEquity[lastIdx] : initialCapital;
    const totalReturn = finalEquity - initialCapital;
    const totalReturnPct = (totalReturn / initialCapital) * 100;

    // Max drawdown from equity curve (peak-relative, time-correct)
    let runningPeak = initialCapital;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    for (let i = 0; i < ecIdx; i++) {
      const currentEquity = ecData.totalEquity[i];
      if (currentEquity > runningPeak) {
        runningPeak = currentEquity;
      }

      const drawdown = runningPeak - currentEquity;
      const drawdownPct = runningPeak > 0 ? (drawdown / runningPeak) * 100 : 0;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
      if (drawdownPct > maxDrawdownPct) {
        maxDrawdownPct = drawdownPct;
      }
    }

    // Trade statistics
    const totalTrades = trades.length;
    const winningTrades = trades.filter((t) => t.netPnl > 0).length;
    const losingTrades = trades.filter((t) => t.netPnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    // P&L stats
    const winPnls = trades.filter((t) => t.netPnl > 0).map((t) => t.netPnl);
    const lossPnls = trades.filter((t) => t.netPnl < 0).map((t) => t.netPnl);
    const avgWin =
      winPnls.length > 0
        ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length
        : 0;
    const avgLoss =
      lossPnls.length > 0
        ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length
        : 0;
    const largestWin = winPnls.length > 0 ? Math.max(...winPnls) : 0;
    const largestLoss = lossPnls.length > 0 ? Math.min(...lossPnls) : 0;
    const avgTradePnl =
      totalTrades > 0
        ? trades.reduce((sum, t) => sum + t.netPnl, 0) / totalTrades
        : 0;

    // Profit factor
    const totalWins = winPnls.reduce((a, b) => a + b, 0);
    const totalLosses = Math.abs(lossPnls.reduce((a, b) => a + b, 0));
    const profitFactor =
      totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Commission & Slippage from all fills/tickets
    let totalCommission = 0;
    let totalSlippage = 0;
    for (const ticket of Object.values(this.state.tickets)) {
      totalCommission += ticket.totalFees ?? 0;
      for (const event of ticket.orderEvents) {
        totalSlippage +=
          Math.abs(event.slippage ?? 0) * Math.abs(event.fillQuantity ?? 0);
      }
    }

    // Risk metrics — resample directly from TypedArrays (no sort, no object creation)
    const dailyReturns = this.resampleToDailyReturns();
    const sharpeRatio = this.calculateSharpeRatio(dailyReturns);
    const sortinoRatio = this.calculateSortinoRatio(dailyReturns);

    // Annualized return from daily resampled curve
    const dailyPoints = dailyReturns.length + 1; // returns = points - 1
    const yearsElapsed = dailyPoints > 1 ? (dailyPoints - 1) / 252 : 0;
    const annualizedReturn =
      yearsElapsed > 0
        ? (Math.pow(finalEquity / initialCapital, 1 / yearsElapsed) - 1) * 100
        : totalReturnPct;

    const calmarRatio =
      maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : 0;

    // Timestamps from TypedArrays
    const startDate =
      ecIdx > 0 ? new Date(ecData.timestamps[0]).toISOString() : "";
    const endDate =
      ecIdx > 0 ? new Date(ecData.timestamps[lastIdx]).toISOString() : "";

    console.log(
      `[SimBroker] Completed: ${trades.length} trades, ${ecIdx} bars`,
    );

    return {
      totalReturn,
      totalReturnPct,
      annualizedReturn,
      maxDrawdown,
      maxDrawdownPct,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      avgTradePnl,
      totalCommission,
      totalSlippage,
      startDate,
      endDate,
      totalBars: ecIdx,
    };
  }

  /**
   * Resample equity curve to daily returns directly from TypedArrays.
   * No sort, no object creation, no Map — just a single linear scan.
   */
  private resampleToDailyReturns(): number[] {
    if (this.equityCurveIndex < 2) return [];

    const DAY_MS = 86_400_000;
    const timestamps = this.equityCurveData.timestamps;
    const totalEquity = this.equityCurveData.totalEquity;
    const dailyCloses: number[] = [];

    let currentDay = Math.floor(timestamps[0] / DAY_MS);
    let lastEquityOfDay = totalEquity[0];

    for (let i = 1; i < this.equityCurveIndex; i++) {
      const day = Math.floor(timestamps[i] / DAY_MS);
      if (day !== currentDay) {
        dailyCloses.push(lastEquityOfDay);
        currentDay = day;
      }
      lastEquityOfDay = totalEquity[i];
    }
    dailyCloses.push(lastEquityOfDay);

    const returns: number[] = [];
    for (let i = 1; i < dailyCloses.length; i++) {
      const previousClose = dailyCloses[i - 1];
      if (previousClose > 0) {
        returns.push((dailyCloses[i] - previousClose) / previousClose);
      }
    }

    return returns;
  }

  private calculateSharpeRatio(
    returns: number[],
    riskFreeRate: number = 0,
  ): number {
    if (returns.length < 30) return 0;

    const dailyRf =
      riskFreeRate === 0 ? 0 : Math.pow(1 + riskFreeRate, 1 / 252) - 1;
    const excessReturns = new Array<number>(returns.length);
    let sum = 0;

    for (let i = 0; i < returns.length; i++) {
      const excessReturn = returns[i] - dailyRf;
      excessReturns[i] = excessReturn;
      sum += excessReturn;
    }

    const avgExcessReturn = sum / excessReturns.length;
    const stdDev = this.standardDeviation(excessReturns);
    const EPSILON = 1e-8;
    if (stdDev < EPSILON) return 0;

    // Annualize
    return (avgExcessReturn / stdDev) * Math.sqrt(252);
  }

  private calculateSortinoRatio(
    returns: number[],
    riskFreeRate: number = 0,
  ): number {
    if (returns.length < 30) return 0;

    const dailyRf =
      riskFreeRate === 0 ? 0 : Math.pow(1 + riskFreeRate, 1 / 252) - 1;
    const excessReturns = new Array<number>(returns.length);
    let sum = 0;

    for (let i = 0; i < returns.length; i++) {
      const excessReturn = returns[i] - dailyRf;
      excessReturns[i] = excessReturn;
      sum += excessReturn;
    }

    const avgExcessReturn = sum / excessReturns.length;

    // Downside deviation (only negative returns)
    const negativeReturns: number[] = [];
    for (let i = 0; i < excessReturns.length; i++) {
      if (excessReturns[i] < 0) negativeReturns.push(excessReturns[i]);
    }
    if (negativeReturns.length === 0) return avgExcessReturn > 0 ? Infinity : 0;

    const downsideDeviation = Math.sqrt(
      negativeReturns.reduce((downsideSum, r) => downsideSum + r * r, 0) /
        negativeReturns.length,
    );

    const EPSILON = 1e-8;
    if (downsideDeviation < EPSILON) return 0;

    // Annualize
    return (avgExcessReturn / downsideDeviation) * Math.sqrt(252);
  }

  private standardDeviation(values: number[]): number {
    if (values.length < 2) return 0;

    const n = values.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    const mean = sum / n;

    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const d = values[i] - mean;
      sumSq += d * d;
    }

    return Math.sqrt(sumSq / (n - 1));
  }

  // ============== GETTERS - ALL SYNCHRONOUS ==============

  getPositions(): Position[] {
    return Object.values(this.state.positions);
  }

  getCash(): number {
    return this.state.cash;
  }

  getTotalEquity(): number {
    return this.state.cash + this.positionsValue;
  }

  /**
   * Get pending orders (derived from tickets with non-terminal status).
   */
  getOpenOrders(): Order[] {
    const pendingOrders: Order[] = [];
    for (const ticketIds of this.pendingTicketsBySymbol.values()) {
      for (const ticketId of ticketIds) {
        const ticket = this.state.tickets[ticketId];
        if (ticket && isTicketPending(ticket)) {
          pendingOrders.push(ticket.order);
        }
      }
    }
    return pendingOrders;
  }

  /**
   * Get all order tickets.
   */
  getTickets(): Record<string, OrderTicket> {
    return this.state.tickets;
  }

  getTrades(): Trade[] {
    return this.state.trades;
  }

  getEquityCurve(): EquityPoint[] {
    // Reconstruct from TypedArrays on demand (for DB persistence only)
    const result: EquityPoint[] = new Array(this.equityCurveIndex);
    for (let i = 0; i < this.equityCurveIndex; i++) {
      result[i] = {
        timestamp: new Date(this.equityCurveData.timestamps[i]).toISOString(),
        cash: this.equityCurveData.cash[i],
        positionsValue: this.equityCurveData.positionsValue[i],
        totalEquity: this.equityCurveData.totalEquity[i],
        drawdownPct: this.equityCurveData.drawdownPct[i],
      };
    }
    return result;
  }

  getConfig(): SimBrokerConfig {
    return this.config;
  }

  getBacktestId(): string {
    return this.backtestId;
  }

  /** Read-only snapshot of a symbol's market state (diagnostics/tests). */
  getMarketState(symbol: string): SymbolMarketState | undefined {
    return this.marketDataBySymbol.get(symbol);
  }

  /** Migration telemetry for deprecated global-bar entry points. */
  getLegacyMarketDataCallCounts(): {
    onBar: number;
    setCurrentBar: number;
    legacySymbolMismatches: number;
  } {
    return {
      onBar: this.legacyOnBarCalls,
      setCurrentBar: this.legacySetCurrentBarCalls,
      legacySymbolMismatches: this.legacySymbolMismatches,
    };
  }

  private getMarketStateForUpdate(symbol: string): SymbolMarketState {
    let state = this.marketDataBySymbol.get(symbol);
    if (!state) {
      state = {
        symbol,
        latestRealBar: null,
        previousRealBar: null,
        latestEventTimestamp: 0,
        lastEnvelopeWasFillForward: false,
      };
      this.marketDataBySymbol.set(symbol, state);
    }
    return state;
  }

  private trackPendingTicket(symbol: string, ticketId: string): void {
    let pending = this.pendingTicketsBySymbol.get(symbol);
    if (!pending) {
      pending = new Set<string>();
      this.pendingTicketsBySymbol.set(symbol, pending);
    }
    pending.add(ticketId);
  }

  private untrackPendingTicket(symbol: string, ticketId: string): void {
    const pending = this.pendingTicketsBySymbol.get(symbol);
    if (!pending) {
      return;
    }
    pending.delete(ticketId);
    if (pending.size === 0) {
      this.pendingTicketsBySymbol.delete(symbol);
    }
  }
}

// Re-export interfaces
export * from "./interfaces";
