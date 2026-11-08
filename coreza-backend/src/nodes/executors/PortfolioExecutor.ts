import { LiveStrategiesRepository } from "../../repositories/LiveStrategiesRepository";
import { OrderOwnerRegistry, OrderOwner } from "../../services/OrderOwnerRegistry";
import { reportingTradeId } from "../../reporting/persistence";
import { NodeResultError } from "../../contracts/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createHash, randomUUID } from "crypto";
import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { SimBroker, Position } from "../../backtest/simBroker";
import { PortfolioManager } from "../../simulation/PortfolioManager";
import { decimal } from "../../portfolio/decimal";
import { createSuccessOutput, createErrorOutput, resultSuccess } from "../../utils/nodeResultHelpers";
import { Bar } from "../../backtest/simBroker/interfaces";
import { parseBar, parsePrices, toPercent } from "../../utils/barParser";
import {
  FormattedPosition,
  formatPositionWithPnlPercent,
  shapePositionQuery,
} from "../../utils/portfolioHelpers";
import { isOurOrder } from "../../utils/orderIdempotency";
import { NodeExecutionContext } from "../../engine/types";
import { FillEventBus, FillStreamEvent } from "../../services/FillEventBus";
import {
  SnapshotCache,
  LatestSnapshotState,
} from "../../services/SnapshotCache";
import { LiveTradeRepository } from "../../repositories/LiveTradeRepository";
import { createLogger } from "../../utils/logger";
import { BrokerExecutor } from "./BrokerExecutor";
import { BROKER_CAPABILITIES } from "../../brokers/capabilities";
import { getBrokerConfig } from "../../brokers";
import { toMarketBarEnvelope } from "../../backtest/simBroker/marketEnvelope";

const fillLogger = createLogger("PortfolioExecutor:fills");
const TERMINAL_ORDER_STATUSES = new Set([
  "filled",
  "finished",
  "canceled",
  "cancelled",
  "rejected",
  "expired",
  "replaced",
  "stopped",
  "suspended",
  "done_for_day",
]);

// Key prefix for SimBroker cache (shared with BacktestExecutor)
const SIM_BROKER_KEY_PREFIX = "simBroker:";

function normalizeSide(value: any): "buy" | "sell" {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (s === "buy") return "buy";
  if (s === "sell") return "sell";
  throw new Error(`side must be BUY or SELL, got: ${value}`);
}

function normalizeSymbol(value: any): string {
  const s = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!s) throw new Error("symbol is required");
  return s;
}

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;

  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function optionalDecimal(value: unknown): string | number | undefined {
  if (value == null || (typeof value === "string" && value.trim() === "")) return undefined;
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Fill values must be decimal strings or numbers");
  return typeof value === "string" ? value.trim() : value;
}

function toArray(value: unknown): any[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore JSON parsing errors and treat as scalar string
    }

    return [value];
  }

  return Array.isArray(value) ? value : [value];
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

/**
 * Unified PortfolioExecutor — handles both backtest (SimBroker) and live broker modes.
 *
 * Backtest mode: Delegates to the SimBroker instance cached by BacktestExecutor
 * Broker mode: Delegates to PortfolioManager for live broker data
 */
type BrokerPortfolioState = ReturnType<PortfolioManager["getPortfolioState"]>;

type TradeAnalytics = {
  netProfit: number;
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  averageTradeReturn: number;
  expectancy: number;
};

type AlpacaAccountResponse = {
  cash?: string | number;
  currency?: string;
  buying_power?: string | number;
  equity?: string | number;
  portfolio_value?: string | number;
  multiplier?: string | number;
  initial_margin?: string | number;
};

type AlpacaPosition = {
  symbol?: string;
  qty?: string | number;
  avg_entry_price?: string | number;
  current_price?: string | number;
  side?: string;
  asset_class?: string;
};

type AlpacaOrder = {
  id?: string;
  client_order_id?: string;
  symbol: string;
  qty: string | number;
  side: string;
  type: string;
  status: string;
  timeInForce: string;
};

function normalizeAlpacaCryptoSymbol(symbol: any, assetClass?: string): string {
  const normalized = normalizeSymbol(symbol);
  if (String(assetClass || "").toLowerCase() !== "crypto") {
    return normalized;
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  const match = normalized.match(/^([A-Z0-9]+)(USDT|USDC|USD|BTC)$/);
  if (!match) {
    return normalized;
  }

  return `${match[1]}/${match[2]}`;
}

export class PortfolioExecutor implements INodeExecutor {
  readonly category = "Portfolio";
  // Backtest mode is fully sync. Broker mode is async, but compiled execution
  // only calls this node in backtest mode and the adapter safely rejects Promise returns.
  readonly syncCapable = true;
  private brokerExecutor = new BrokerExecutor();

  // Local ownership cache: avoids Redis round-trip on every fill event (5-min TTL)
  private static ownershipCache = new Map<
    string,
    { ours: boolean; expiry: number }
  >();
  private static ownershipLookupCount = 0;

  private async checkOwnership(
    userId: string,
    workflowId: string,
    id: string,
  ): Promise<boolean> {
    const cacheKey = `${userId}:${workflowId}:${id}`;
    // Periodic sweep every 1000 lookups to prevent unbounded memory growth
    if (++PortfolioExecutor.ownershipLookupCount % 1000 === 0) {
      const now = Date.now();
      for (const [key, val] of PortfolioExecutor.ownershipCache) {
        if (val.expiry < now) PortfolioExecutor.ownershipCache.delete(key);
      }
    }

    const cached = PortfolioExecutor.ownershipCache.get(cacheKey);
    //if (cached && cached.expiry > Date.now()) return cached.ours;

    const result = await isOurOrder(userId, workflowId, id);
    PortfolioExecutor.ownershipCache.set(cacheKey, {
      ours: result.ours,
      expiry: Date.now() + 300_000, // 5 minutes
    });
    return result.ours;
  }

  /**
   * Parse a symbol param into an array. Supports comma-separated values.
   * e.g. "BTCUSDT" -> ["BTCUSDT"], "BTCUSDT,ETHUSDT" -> ["BTCUSDT","ETHUSDT"]
   */
  private parseSymbols(symbol?: string): string[] {
    if (!symbol) return [];
    return symbol
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  // Reference to the shared SimBroker cache from BacktestExecutor
  private static simBrokerCache = new Map<string, SimBroker>();

  /**
   * Allow BacktestExecutor to share its SimBroker cache reference.
   */
  static setSimBrokerCache(cache: Map<string, SimBroker>): void {
    PortfolioExecutor.simBrokerCache = cache;
  }

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: NodeExecutionContext,
  ): NodeResult | Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Configuration is independent of the native numeric cumulativeFilledQty field.
      params._cumulativeFillValues = node.values?.cumulativeFilledQty === true;
      const mode = params.mode;

      if (mode === "backtest") {
        return this.executeBacktestMode(params, context);
      } else if (mode === "broker") {
        // if (node.values?.credential_id) {
        //   params.credential_id = node.values.credential_id;
        // }
        return this.executeBrokerMode(params, context);
      }

      return createErrorOutput(`Unknown portfolio mode: ${mode}`);
    } catch (error) {
      console.error("[PortfolioExecutor] Execution failed:", error);
      return createErrorOutput(error);
    }
  }

  // ============== BACKTEST MODE ==============

  private executeBacktestMode(
    params: any,
    context?: NodeExecutionContext,
  ): NodeResult {
    return this.executeBacktestModeSync(params, context);
  }

  private executeBacktestModeSync(
    params: any,
    _context?: NodeExecutionContext,
  ): NodeResult {
    const backtestId = params.backtestId;
    if (!backtestId) {
      return createErrorOutput("backtest_id is required");
    }

    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    const simBroker = PortfolioExecutor.simBrokerCache.get(key);
    if (!simBroker) {
      return createErrorOutput(
          `No SimBroker found for backtest ${backtestId}. Ensure BacktestInit ran first.`,
        );
    }

    const operation = params.operation || "get_portfolio";
    const symbol = params.symbol?.trim().toUpperCase();
    const currentBar = parseBar(params.currentBar);
    const prices = parsePrices(params.prices);

    // Mark-to-market before reading
    if (
      ["get_portfolio", "get_position", "update_mtm", "get_equity"].includes(
        operation,
      )
    ) {
      if (prices && Object.keys(prices).length > 0) {
        simBroker.updateAllPositionsMTM(prices);
      } else if (currentBar && symbol) {
        const mtmEnvelope = toMarketBarEnvelope(symbol, params.currentBar);
        if (mtmEnvelope) simBroker.onBar(mtmEnvelope);
      }
    }

    switch (operation) {
      case "get_portfolio":
        return this.backtestGetAll(simBroker);
      case "get_position":
        return this.backtestGetPosition(simBroker, symbol);
      case "update_mtm":
        return this.backtestUpdateMTM(simBroker, symbol, currentBar, prices);
      case "get_cash":
        return this.backtestGetCash(simBroker);
      case "get_equity":
        return this.backtestGetEquity(simBroker);
      case "get_trades":
        return this.backtestGetTrades(simBroker);
      default:
        return createErrorOutput(`Unknown portfolio operation: ${operation}`);
    }
  }

  // ============== BROKER MODE ==============

  private async executeBrokerMode(
    params: any,
    context?: NodeExecutionContext,
  ): Promise<NodeResult> {
    const userId = context?.userId;
    if (!context || !userId) {
      return createErrorOutput("User ID required for broker mode");
    }

    const operation = params.operation || "get_portfolio";
    let reportingOwner: OrderOwner | null = null;
    const currentActivationId = context.reportingExecutionId ?? context.executionId;
    if (operation === "sync_order_event" && (context.executionMode === "live" || context.reportingExecutionId) && params.broker) {
      const owner = await OrderOwnerRegistry.findOwner(`${params.broker}_trading`, {
        orderId: params.orderId, clientOrderId: params.clientOrderId,
        algoId: params.algoId, clientAlgoId: params.clientAlgoId,
      });
      if (owner?.reportingExecutionId && owner.userId === userId && owner.workflowId === context.workflowId) {
        reportingOwner = owner;
        context = { ...context, reportingExecutionId: owner.reportingExecutionId };
      }
    }
    const executionId = context.reportingExecutionId ?? context.executionId;
    if (!executionId) {
      return createErrorOutput(
          "executionId is required for broker mode — cannot use workflowId as fallback",
        );
    }

    // Get or create PortfolioManager
    const isPreviousActivation = executionId !== currentActivationId;
    const existing = PortfolioManager.existingInstance(userId, executionId);
    if (isPreviousActivation && !existing) {
      if (params._cumulativeFillValues === true) {
        return createErrorOutput("Prior activation order totals are unavailable; cumulative input cannot be recorded as an incremental fill");
      }
      // Preserve raw fill attribution without inventing a position or resetting old equity.
      await FillEventBus.publish(this.buildFillStreamEvent({
        context, params, symbol: String(params.symbol || ""), side: params.side,
        orderId: String(params.orderId || ""), brokerExecutionId: params.brokerExecutionId,
        filledQty: toNumber(params.filledQty) ?? 0, fillPrice: toNumber(params.avgFillPrice) ?? 0,
        fillStatus: params.status, feeAmount: toNumber(params.feeAmount), feeAsset: params.feeAsset,
        baseCurrency: params.base_currency, algoId: params.algoId,
      }));
      return createErrorOutput("Late fill retained for its previous activation; portfolio state requires reconciliation");
    }
    const pm = existing ?? PortfolioManager.getInstance(userId, executionId);

    const symbols = this.parseSymbols(params.symbol);
    const baseCurrency = params.base_currency || "USDT";

    if (operation === "create_portfolio") {
      if (pm.isBootstrapped()) {
        return createSuccessOutput({
            message: "Portfolio already initialized",
            already_created: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          });
      }

      // Read balance fields (broker mode uses balance_cash, backtest uses cash_balance)
      const cash = toNumber(params.balance_cash ?? params.cash_balance) ?? 0;
      pm.initializePortfolio(baseCurrency, cash);

      // Reconcile balance with explicit values if provided
      const buyingPower = toNumber(params.balance_buying_power);
      const equity = toNumber(params.balance_equity);
      const margin = toNumber(params.balance_margin);
      const initialMargin = toNumber(params.balance_initial_margin);

      if (
        buyingPower !== undefined ||
        equity !== undefined ||
        margin !== undefined ||
        initialMargin !== undefined
      ) {
        pm.reconcileBalance({
          asset: baseCurrency,
          cash,
          buyingPower,
          initialMargin,
          margin: margin ?? 1,
          equity: equity ?? cash,
        });
      }

      // Seed positions — supports single value or parallel arrays
      const posSymbols = toArray(params.position_symbol);
      const posQuantities = toArray(params.position_quantity);
      const posSides = toArray(params.position_side);
      const posAvgPrices = toArray(params.position_avg_fill_price);
      const posCurPrices = toArray(params.position_current_price);
      const posOpenCostBasis = toArray(params.position_open_cost_basis);
      const posMarketValue = toArray(params.position_market_value);
      const posRealizedPnl = toArray(params.position_realized_pnl);
      const posUnrealizedPnl = toArray(params.position_unrealized_pnl);

      for (let i = 0; i < posSymbols.length; i++) {
        const symbol = String(posSymbols[i] ?? "")
          .trim()
          .toUpperCase();
        const qty = toNumber(posQuantities[i]);
        if (!symbol || qty === undefined) continue;

        const sideValue = String(posSides[i] ?? posSides[0] ?? "long")
          .trim()
          .toLowerCase();
        const side = sideValue === "short" ? "sell" : "buy";

        pm.applyPositionUpdate({
          symbol,
          filledQty: qty,
          avgFillPrice: toNumber(posAvgPrices[i]) ?? 0,
          side,
          currentPrice: toNumber(posCurPrices[i]),
          openCostBasis: toNumber(posOpenCostBasis[i]) ?? 0,
          marketValue: toNumber(posMarketValue[i]) ?? 0,
          realizedPnl: toNumber(posRealizedPnl[i]) ?? 0,
          unrealizedPnl: toNumber(posUnrealizedPnl[i]) ?? 0,
        });
      }

      pm.initializeEquity(baseCurrency);
      const explicitCapital = toNumber(params.balance_equity) ?? (posSymbols.length === 0 ? toNumber(params.balance_cash ?? params.cash_balance) : undefined);
      if (explicitCapital !== undefined && (context.executionMode === "live" || context.reportingExecutionId)) {
        await LiveStrategiesRepository.recordBaseline(userId, context.workflowId, executionId, explicitCapital, {
          broker: params.broker || "unknown", credential_id: params.credential_id || userId, base_currency: baseCurrency,
        });
      }
      return createSuccessOutput({
          message: "Portfolio created with explicit balance and position data",
          created: true,
          ...this.getPortfolioSummary(pm, baseCurrency),
        });
    }

    if (operation === "sync_broker_state") {
      return this.brokerSyncState(pm, params, context);
    }

    switch (operation) {
      // ============== NEW v2 OPERATIONS ==============
      case "register_order_intent":
        return this.brokerRegisterOrderIntent(pm, params);
      case "sync_order_event":
        return this.brokerSyncOrderEvent(pm, params, context, Boolean(reportingOwner));
      case "get_portfolio":
        return this.brokerGetAll(pm, baseCurrency);
      case "get_cash":
        return createSuccessOutput({ cash: pm.getCash() });
      case "get_equity":
        return createSuccessOutput({ equity: pm.getTotalEquity(baseCurrency) });
      case "update_mtm": {
        // Accept marketPrice (new)
        const mtmPrice = toNumber(params.marketPrice ?? params.price);
        if (symbols.length === 0 || mtmPrice === undefined || mtmPrice <= 0) {
          return createErrorOutput("Provide symbol and marketPrice for update_mtm");
        }

        const priceMap: Record<string, number> = {};
        for (const sym of symbols) {
          priceMap[sym] = mtmPrice;
        }

        pm.updateMarketPrices(priceMap, baseCurrency);
        return createSuccessOutput({
            updated: true,
            prices_updated: priceMap,
            ...this.getPortfolioSummary(pm, baseCurrency),
          });
      }
      case "get_position":
        return this.brokerGetPosition(pm, symbols);
      case "get_trades":
        return this.brokerGetTrades(pm);
      case "cancel_order": {
        const cancelOrderId = params.broker_order_id;
        if (!cancelOrderId) {
          return createErrorOutput(
              "broker_order_id (or fill_id) is required for cancel_order",
            );
        }

        const openOrder = pm
          .getOpenOrders()
          .find(
            (o) =>
              o.orderId === cancelOrderId ||
              (o.clientOrderId && o.clientOrderId === cancelOrderId),
          );
        const orderType = String(
          openOrder?.orderType || params.orderType || "",
        ).toUpperCase();
        const isAlgoOrder = [
          "STOP",
          "STOP_MARKET",
          "TAKE_PROFIT",
          "TAKE_PROFIT_MARKET",
          "TRAILING_STOP_MARKET",
        ].includes(orderType);

        if (this.supportsAlgoOrders(params.broker) && params.credential_id) {
          await this.callBrokerOperation(
            "cancel_order",
            {
              credential_id: params.credential_id,
              environment: params.environment || "testnet",
              marketType: params.marketType || "futures",
              symbol: params.symbol || openOrder?.symbol,
              order_id: cancelOrderId,
              orderType,
              isAlgo: params.isAlgo === true || isAlgoOrder,
            },
            "binance",
            context,
          );
        }

        const cancelResult = pm.cancelOrder(cancelOrderId);
        return createSuccessOutput({
            removed: cancelResult.removed,
            cancelledOrder: cancelResult.order || null,
            isAlgo: params.isAlgo === true || isAlgoOrder,
          });
      }
      case "get_open_algo_orders": {
        if (!this.supportsAlgoOrders(params.broker)) {
          return createErrorOutput(
              "get_open_algo_orders is not supported by this broker",
            );
        }

        const result = await this.callBrokerOperation(
          "get_open_algo_orders",
          {
            credential_id: params.credential_id,
            environment: params.environment || "testnet",
            marketType: params.marketType || "futures",
            symbol: params.symbol,
            algoType: params.algoType,
          },
          "binance",
          context,
        );

        return createSuccessOutput(result || {});
      }
      case "get_all_algo_orders": {
        if (!this.supportsAlgoOrders(params.broker)) {
          return createErrorOutput(
              "get_all_algo_orders is not supported by this broker",
            );
        }

        const result = await this.callBrokerOperation(
          "get_all_algo_orders",
          {
            credential_id: params.credential_id,
            environment: params.environment || "testnet",
            marketType: params.marketType || "futures",
            symbol: params.symbol,
            algoType: params.algoType,
            startTime: params.startTime,
            endTime: params.endTime,
            limit: params.limit,
          },
          "binance",
          context,
        );

        return createSuccessOutput(result || {});
      }
      case "get_open_orders": {
        const openOrders = pm.getOpenOrders();
        const openAlgoOrders = pm.getOpenAlgoOrders();
        const filterSymbol = params.symbol?.trim().toUpperCase();
        const filteredOpenOrders = filterSymbol
          ? openOrders.filter((o) => o.symbol === filterSymbol)
          : openOrders;
        const filteredAlgoOrders = filterSymbol
          ? openAlgoOrders.filter((o) => o.symbol === filterSymbol)
          : openAlgoOrders;

        return createSuccessOutput({
            openOrders: filteredOpenOrders,
            algoOrders: filteredAlgoOrders,
          });
      }
      default:
        return createErrorOutput(`Unknown portfolio operation: ${operation}`);
    }
  }

  private supportsAlgoOrders(broker?: string): boolean {
    const brokerKey = String(broker || "")
      .trim()
      .toLowerCase();
    return Boolean(BROKER_CAPABILITIES[brokerKey]?.supportsAlgoOrders);
  }

  private async callBrokerOperation(
    operation: string,
    params: Record<string, any>,
    broker: string = "alpaca",
    context?: NodeExecutionContext,
  ): Promise<any> {
    const result = await this.brokerExecutor.execute(
      {
        id: `portfolio-sync-${operation}`,
        name: broker,
        category: "Broker",
        node_type: broker,
        subCategory: broker,
        values: {
          operation,
          ...params,
        },
      } as WorkflowNode,
      {},
      context,
    );

    if (result.status === "error") {
      throw new NodeResultError(result);
    }

    return result.data;
  }

  private async brokerSyncState(
    pm: PortfolioManager,
    params: any,
    context?: NodeExecutionContext,
  ): Promise<NodeResult> {
    try {
      if (params.broker !== "alpaca") {
        return createErrorOutput(
            "sync_from_broker currently supports broker=alpaca only",
          );
      }

      if (!params.credential_id) {
        return createErrorOutput(
            "credential_id is required when sync_from_broker is enabled",
          );
      }

      const brokerParams = {
        credential_id: params.credential_id,
        environment: params.environment || "paper",
      };

      const account = (await this.callBrokerOperation(
        "get_account",
        brokerParams,
        "alpaca",
        context,
      )) as AlpacaAccountResponse;

      const positionsResult = (await this.callBrokerOperation(
        "get_positions",
        brokerParams,
        "alpaca",
        context,
      )) as { positions?: AlpacaPosition[] };
      const positions = Array.isArray(positionsResult.positions)
        ? positionsResult.positions
        : [];

      const ordersResult = (await this.callBrokerOperation(
        "get_orders",
        {
          ...brokerParams,
          status: "open",
        },
        "alpaca",
        context,
      )) as { orders?: AlpacaOrder[] };
      const allOrders = Array.isArray(ordersResult.orders)
        ? ordersResult.orders
        : [];
      const openOrders = allOrders.filter((order) => {
        const status = String(order.status ?? "").toLowerCase();
        return ![
          "filled",
          "canceled",
          "cancelled",
          "expired",
          "rejected",
        ].includes(status);
      });

      const baseCurrency = String(account.currency || "USD").toUpperCase();
      const cash = toNumber(account.cash) ?? 0;
      const buyingPower = toNumber(account.buying_power) ?? cash;
      const margin = toNumber(account.multiplier) ?? 1;
      const equity = toNumber(account.equity) ?? 1;
      const initialMargin = toNumber(account.initial_margin);
      pm.initializePortfolio(baseCurrency, cash);

      pm.reconcileBalance({
        asset: baseCurrency,
        cash: cash,
        buyingPower: toNumber(account.buying_power) ?? cash,
        initialMargin: initialMargin,
        margin: margin,
        equity: equity,
        locked: Math.max(0, (toNumber(account.equity) ?? cash) - cash),
      });

      const syncedPositions: Array<{
        symbol: string;
        qty: number;
        avg_entry_price?: number;
        current_price?: number;
        side?: string;
      }> = [];

      for (const position of positions) {
        if (!position.symbol) continue;
        const symbol = normalizeAlpacaCryptoSymbol(
          position.symbol,
          position.asset_class,
        );
        const qty = Math.abs(toNumber(position.qty) ?? 0);
        if (qty <= 0) continue;
        const side =
          String(position.side ?? "").toLowerCase() === "short"
            ? "sell"
            : "buy";

        pm.applyPositionUpdate({
          symbol,
          positionQty: qty,
          avgFillPrice: toNumber(position.avg_entry_price) ?? 0,
          side,
          currentPrice: toNumber(position.current_price),
        });

        syncedPositions.push({
          symbol,
          qty,
          avg_entry_price: toNumber(position.avg_entry_price),
          current_price: toNumber(position.current_price),
          side: position.side,
        });
      }

      const syncedOrders: Array<{
        orderId: string;
        clientOrderId?: string;
        symbol: string;
        side: string;
        qty: number;
        status?: string;
      }> = [];

      for (const order of openOrders) {
        const orderId = order.id || order.client_order_id;
        const symbol = order.symbol;
        if (!orderId || !symbol || !order.side) continue;
        const normalizedSymbol = normalizeSymbol(symbol);
        const side = normalizeSide(order.side);
        const orderQty = Math.abs(toNumber(order.qty) ?? 0);

        pm.registerOrderIntent({
          orderId,
          clientOrderId: order.client_order_id,
          symbol: normalizedSymbol,
          side,
          origQty: orderQty,
          orderType: order.type ?? "",
          status: order.status ?? "unknown",
          timeInForce: order.timeInForce ?? "",
        });

        syncedOrders.push({
          orderId,
          clientOrderId: order.client_order_id,
          symbol: normalizedSymbol,
          side,
          qty: orderQty,
          status: order.status,
        });
      }

      return createSuccessOutput({
          environment: brokerParams.environment,
          cash,
          currency: baseCurrency,
          buyingPower,
          margin,
          initialMargin,
          equity,
          positions: syncedPositions,
          openOrders: syncedOrders,
        });
    } catch (error: any) {
      return createErrorOutput(error?.message || "Failed to sync broker state");
    }
  }

  private brokerRegisterOrderIntent(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    try {
      const orderId = params.orderId;
      const clientOrderId = params.clientOrderId;
      const algoId = params.algoId;
      const symbol = params.symbol;
      const side = params.side;
      const orderType = params.orderType;
      const origQty = toNumber(params.origQty);
      const timeInForce = params.timeInForce;
      const limitPrice = toNumber(params.limitPrice);
      const stopPrice = toNumber(params.stopPrice);
      const trailPercent = toNumber(params.trailPercent);
      const trailPrice = toNumber(params.trailPrice);
      const status = params.status;
      const result = pm.registerOrderIntent({
        orderId,
        clientOrderId,
        symbol,
        algoId,
        side,
        origQty,
        orderType,
        timeInForce,
        limitPrice,
        stopPrice,
        trailPercent,
        trailPrice,
        status,
      });

      return createSuccessOutput({
          order: result.order,
          pendingOrdersCount: pm.getOpenOrders().length,
        });
    } catch (error: any) {
      return createErrorOutput(error.message);
    }
  }

  private async brokerEnsureOwnedOrder(
    userId: string,
    workflowId: string,
    orderId?: string,
    clientOrderId?: string,
  ): Promise<{ ours: boolean }> {
    if (!orderId && !clientOrderId) {
      return { ours: true };
    }

    const isOurs =
      (orderId && (await this.checkOwnership(userId, workflowId, orderId))) ||
      (clientOrderId &&
        (await this.checkOwnership(userId, workflowId, clientOrderId)));

    return { ours: !!isOurs };
  }

  private buildDeterministicEventId(parts: Record<string, any>): string {
    const payload = JSON.stringify(parts);
    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  private buildFillStreamEvent(opts: {
    context: NodeExecutionContext;
    params: any;
    symbol: string;
    side: string;
    orderId?: string;
    brokerExecutionId?: string;
    filledQty: number;
    fillPrice: number;
    fillStatus?: string;
    feeAmount?: number;
    feeAsset?: string;
    baseCurrency?: string;
    algoId?: string;
    rejectReason?: string;
    orderType?: string;
    limitPrice?: number;
    stopPrice?: number;
    trailPercent?: number;
    trailPrice?: number;
    timeInForce?: string;
    tag?: string;
  }): FillStreamEvent {
    const eventTime =
      opts.params.event_time ||
      opts.params.eventTime ||
      new Date().toISOString();

    const nativeId = opts.brokerExecutionId == null ? "" : String(opts.brokerExecutionId).trim();
    const sequence = toNumber(opts.params._seq);
    const validSequence = sequence != null && Number.isSafeInteger(sequence) && sequence > 0;
    if (opts.filledQty > 0 && (!nativeId || nativeId === "-1") && !validSequence) {
      throw new Error("Broker Execution ID (brokerExecutionId) or a positive execution sequence is required for fills");
    }
    const executionKey = opts.params._cumulativeFillValues === true
      ? ["cumulative", decimal(optionalDecimal(opts.params.filledQty) ?? 0).toString()]
      : nativeId && nativeId !== "-1" ? ["execution", nativeId]
      : validSequence ? ["sequence", sequence]
      : ["fill", opts.filledQty, opts.fillPrice, eventTime];
    const fillId = this.buildDeterministicEventId({
        user_id: opts.context.userId,
        broker: opts.params.broker || "unknown",
        credential_id: opts.params.credential_id ?? "",
        environment: opts.params.environment ?? "",
        workflow_id: opts.context.workflowId,
        execution_id: opts.context.reportingExecutionId ?? opts.context.executionId,
        symbol: opts.symbol,
        order_id: opts.orderId,
        side: opts.side,
        execution_key: executionKey,
      });

    return {
      fill_id: fillId,
      user_id: opts.context.userId,
      workflow_id: opts.context.workflowId,
      execution_id: opts.context.reportingExecutionId ?? opts.context.executionId,
      broker: opts.params.broker || "unknown",
      credential_id: opts.params.credential_id,
      symbol: opts.symbol,
      side: opts.side as "buy" | "sell",
      order_id: opts.orderId,
      fill_qty_delta: opts.filledQty,
      fill_price: opts.fillPrice,
      quote_qty: opts.filledQty * opts.fillPrice,
      commission: opts.feeAmount,
      commission_asset: opts.feeAsset,
      event_time: eventTime,
      base_currency: opts.baseCurrency,
      fill_status: opts.fillStatus,
      algo_id: opts.algoId,
      reject_reason: opts.rejectReason,
      order_type: opts.orderType,
      limit_price: opts.limitPrice,
      stop_price: opts.stopPrice,
      trail_percent: opts.trailPercent,
      trail_price: opts.trailPrice,
      timeInForce: opts.timeInForce || "",
      tag: opts.tag,
    };
  }

  private buildLatestSnapshot(
    pm: PortfolioManager,
    meta: {
      userId: string;
      workflowId: string;
      runId?: string;
      broker: string;
      credentialId?: string;
      baseCurrency?: string;
    },
  ): LatestSnapshotState {
    const state = pm.getPortfolioState(meta.baseCurrency);
    const balances = pm.getCash() as Record<string, unknown>;
    const baseCashRaw =
      (meta.baseCurrency && balances
        ? balances[meta.baseCurrency]
        : undefined) ?? 0;
    const baseCash =
      typeof baseCashRaw === "number" ? baseCashRaw : Number(baseCashRaw) || 0;

    return {
      id: randomUUID(),
      user_id: meta.userId,
      workflow_id: meta.workflowId,
      execution_id: meta.runId,
      broker: meta.broker,
      credential_id: meta.credentialId,
      snapshot_at: new Date().toISOString(),
      base_currency: meta.baseCurrency,
      cash: baseCash,
      equity: state.totalEquity,
      realized_pnl: state.cumulativeRealizedPnl,
      unrealized_pnl: state.positions.reduce((s, p) => s + p.unrealizedPnl, 0),
      positions_count: state.positions.length,
      balances_json: balances,
    };
  }

  /**
   * Persist a Binance algo (conditional) order lifecycle event to live_fills.
   * Reuses the FillEventBus → FillSyncWorker → LiveFillRepository path. The
   * existing unique constraint (user_id, broker, symbol, fill_id) naturally
   * upserts the same algoId across NEW → TRIGGERING → TRIGGERED → FINISHED.
   */
  private async brokerSyncAlgoUpdate(
    pm: PortfolioManager,
    params: any,
    context?: NodeExecutionContext,
  ): Promise<NodeResult> {
    try {
      const algoId = String(params.algoId);
      const symbol = String(params.symbol || "*").toUpperCase();
      const algoStatus = String(params.status || "").toLowerCase();
      const orderId = params.orderId ? String(params.orderId) : undefined;
      const origQty = toNumber(params.origQty);
      const stopPrice = toNumber(params.stopPrice);
      const limitPrice = toNumber(params.limitPrice);
      const trailPercent = toNumber(params.trailPercent);
      const trailPrice = toNumber(params.trailPrice);
      const timeInForce = params.timeInForce;

      const eventTime =
        params.event_time || params.eventTime || new Date().toISOString();

      // Stuff reject reason into commission_asset for algo rows (no new column).
      const rejectReason = params.rejectReason
        ? String(params.rejectReason)
        : undefined;

      pm.applyAlgoUpdate({
        algoId: algoId,
        orderId,
        symbol,
        side:
          (String(params.side || "").toLowerCase() as "buy" | "sell") || "buy",
        orderType: params.orderType,
        origQty,
        status: algoStatus,
        stopPrice,
        limitPrice,
        trailPercent,
        trailPrice,
        rejectReason,
        timeInForce,
        //_seq: toNumber(params._seq),
      });

      // Persist only when running live with workflow context.
      if (
        (context?.executionMode !== "live" && !context?.reportingExecutionId) ||
        !context?.userId ||
        !context?.workflowId
      ) {
        return createSuccessOutput({
            algo: true,
            algoId,
            algoStatus,
            orderId: orderId ?? null,
            persisted: false,
          });
      }

      const event: FillStreamEvent = {
        fill_id: algoId ? `algo:${algoId}` : "",
        algo_id: algoId,
        user_id: context.userId,
        workflow_id: context.workflowId,
        execution_id: context.reportingExecutionId ?? context.executionId,
        broker: params.broker,
        credential_id: params.credential_id,
        symbol,
        side:
          (String(params.side || "").toLowerCase() as "buy" | "sell") || "buy",
        order_id: orderId,
        fill_qty_delta: 0,
        fill_price: 0,
        quote_qty: 0,
        commission: 0,
        commission_asset: undefined,
        limit_price: limitPrice,
        stop_price: stopPrice,
        trail_percent: trailPercent,
        trail_price: trailPrice,
        order_type: params.orderType,
        tag: rejectReason ? `algo:${rejectReason}` : "algoUpdate",
        event_time: eventTime,
        timeInForce,
        fill_status: algoStatus,
        reject_reason: rejectReason,
      };

      void FillEventBus.publish(event).catch((err) =>
        fillLogger.warn(
          { err, fillId: event.fill_id, algoStatus },
          "algo fill event append failed",
        ),
      );

      return createSuccessOutput({
          algo: true,
          algoId,
          algoStatus,
          orderId: orderId ?? null,
          origQty,
          stopPrice,
          limitPrice,
          trailPercent,
          trailPrice,
          rejectReason: rejectReason ?? null,
          persisted: true,
        });
    } catch (err: any) {
      fillLogger.warn({ err }, "brokerSyncAlgoUpdate failed");
      return createErrorOutput(err?.message || "algo_update sync failed");
    }
  }

  private async brokerSyncOrderEvent(
    pm: PortfolioManager,
    params: any,
    context?: NodeExecutionContext,
    verifiedReportingOwner = false,
  ): Promise<NodeResult> {
    // Algo lifecycle (Binance ALGO_UPDATE) — single upserted row in live_fills via
    // the existing FillEventBus path (algo_id set). Algo events carry no fill
    // qty and no position update — they describe the conditional order's lifecycle
    // (NEW → TRIGGERING → TRIGGERED → FINISHED / REJECTED / CANCELED / EXPIRED).
    if (params?.algoId) {
      return this.brokerSyncAlgoUpdate(pm, params, context);
    }
    try {
      if (params.type === "listen_key_expired") {
        fillLogger.warn(
          {
            broker: params.broker || "unknown",
            credential_id: params.credential_id,
            workflow_id: context?.workflowId,
          },
          "listen key expired event received",
        );
        let reconciliation: any = null;
        if (this.supportsAlgoOrders(params.broker) && params.credential_id) {
          try {
            reconciliation = await this.callBrokerOperation(
              "get_open_algo_orders",
              {
                credential_id: params.credential_id,
                environment: params.environment || "testnet",
                marketType: params.marketType || "futures",
                symbol: params.symbol,
              },
              "binance",
              context,
            );
          } catch (error: any) {
            fillLogger.warn(
              { error: error?.message },
              "listen key expiry reconciliation failed",
            );
          }
        }
        return createSuccessOutput({
            acknowledged: true,
            reconciliation,
          });
      }

      const baseCurrency = params.base_currency || "USDT";
      const symbol = params.symbol;
      const orderId = params.orderId;
      const clientOrderId = params.clientOrderId;
      //const algoId = params.algoId;
      const status = params.status;
      const side =
        params.side != null && params.side !== ""
          ? normalizeSide(params.side)
          : undefined;

      const origQty = toNumber(params.origQty);
      const positionQty = optionalDecimal(params.positionQty);
      const limitPrice = toNumber(params.limitPrice);
      const stopPrice = toNumber(params.stopPrice);
      const trailPercent = toNumber(params.trailPercent);
      const trailPrice = toNumber(params.trailPrice);
      const seq = toNumber(params._seq);

      const feeAsset = params.feeAsset;

      const normalizedBrokerId =
        orderId != null && orderId !== "" ? String(orderId) : undefined;

      if (!normalizedBrokerId) {
        throw new Error("Missing orderId and algoId for sync_order_event");
      }

      const { ours } = await this.brokerEnsureOwnedOrder(
        context?.userId ?? "system",
        context?.workflowId ?? "manual",
        normalizedBrokerId,
        clientOrderId,
      );
      if (!ours && !verifiedReportingOwner) {
        return createSuccessOutput({
            skipped: true,
            reason: "unknown_order",
            normalizedBrokerId,
            clientOrderId,
          });
      }

      if (/future|margin|option/i.test(String(params.broker) + String(params.marketType ?? ""))) throw new Error("Portfolio fill accounting requires a supported cash/spot instrument model");
      const timestamp = params.event_time ?? params.eventTime ?? new Date().toISOString();
      const accepted = pm.applyOrderEvent({
        orderId: normalizedBrokerId, clientOrderId, symbol: normalizeSymbol(symbol), side, status,
        quantity: optionalDecimal(params.filledQty), price: optionalDecimal(params.avgFillPrice), fee: optionalDecimal(params.feeAmount),
        cumulative: params._cumulativeFillValues === true,
        origQty, orderType: params.orderType, timeInForce: params.timeInForce, limitPrice, stopPrice, trailPercent, trailPrice,
        executionId: params.brokerExecutionId == null ? undefined : String(params.brokerExecutionId), sequence: seq,
        scope: JSON.stringify([params.broker ?? "", params.environment ?? "", params.credential_id ?? ""]),
        feeAsset, baseCurrency, positionQty,
        resolveInventoryQuantity: getBrokerConfig(params.broker ?? "")?.resolvePortfolioInventoryQuantity,
        timestamp: typeof timestamp === "number" ? new Date(timestamp).toISOString() : String(timestamp),
      });
      const finalizedTrade = accepted.trade;
      if (finalizedTrade) {
        // Persist closed trade to shared reporting storage
        if (
          finalizedTrade &&
          (context?.executionMode === "live" || context?.reportingExecutionId) &&
          context?.userId &&
          context?.workflowId
        ) {
          void LiveTradeRepository.insert({
            id: reportingTradeId(context.reportingExecutionId ?? context.executionId, finalizedTrade.id),
            user_id: context.userId,
            workflow_id: context.workflowId,
            execution_id: context.reportingExecutionId ?? context.executionId,
            symbol: finalizedTrade.symbol,
            action: finalizedTrade.side,
            quantity: finalizedTrade.quantity,
            entryPrice: finalizedTrade.entryPrice,
            entryTime: finalizedTrade.entryTime,
            exitPrice: finalizedTrade.exitPrice,
            exitTime: finalizedTrade.exitTime,
            commission: finalizedTrade.commission,
            slippage: finalizedTrade.slippage,
            net_pnl: finalizedTrade.netPnl,
            gross_pnl: finalizedTrade.grossPnl,
            entry_order_id: finalizedTrade.entryOrderId,
            exit_order_id: finalizedTrade.exitOrderId,
            holding_period_bars: finalizedTrade.holdingPeriodBars,
          }).catch((err) =>
            fillLogger.warn(
              { err, symbol: finalizedTrade!.symbol },
              "live trade persist failed",
            ),
          );
        }
      }

      // The transition above has already applied positions, cash, fees and order progress.
      // Reporting remains fire-and-forget and adds no database wait to execution.
      if (accepted.quantity > 0 && orderId) {
        if (
          (context?.executionMode === "live" || context?.reportingExecutionId) &&
          context?.userId && context?.workflowId
        ) {
          const event = this.buildFillStreamEvent({
            context,
            params,
            symbol,
            side: side ?? pm.getOrder(normalizedBrokerId)!.side,
            orderId: normalizedBrokerId,
            brokerExecutionId: params.brokerExecutionId,
            filledQty: accepted.quantity,
            fillPrice: accepted.price,
            fillStatus: params.status,
            feeAmount: accepted.fee,
            feeAsset: accepted.feeAsset || feeAsset || baseCurrency,
            baseCurrency,
            orderType: params.orderType,
            limitPrice: toNumber(params.limitPrice) ?? toNumber(params.price),
            stopPrice: toNumber(params.stopPrice),
            trailPercent: toNumber(params.trailPercent),
            trailPrice: toNumber(params.trailPrice),
            timeInForce: params.timeInForce,
            tag: params.tag || context.nodeId,
          });

          event.quote_qty = accepted.notional;
          void FillEventBus.publish(event).catch((err) =>
            fillLogger.warn(
              { err, fillId: event.fill_id },
              "fill event append failed",
            ),
          );

          // 6. Coalesced snapshot update
          const snapshot = this.buildLatestSnapshot(pm, {
            userId: context.userId,
            workflowId: context.workflowId,
            runId: context.reportingExecutionId ?? context.executionId,
            broker: params.broker || "unknown",
            credentialId: params.credential_id,
            baseCurrency,
          });
          void SnapshotCache.upsertLatest(snapshot).catch((err) =>
            fillLogger.warn({ err }, "snapshot cache update failed"),
          );
        }
      }

      return createSuccessOutput({
          ...this.getPortfolioSummary(pm, baseCurrency),
          execution_applied: accepted.quantity > 0,
          ...(accepted.quantity > 0 ? { netPositionDelta: accepted.netPositionDelta, baseFeeQty: accepted.baseFeeQty, feeAsset: accepted.feeAsset } : {}),
          ...(accepted.reason ? { skip_reason: accepted.reason } : {}),
        });
    } catch (error: any) {
      return createErrorOutput(error.message);
    }
  }

  // ============== BACKTEST HELPERS ==============

  private backtestGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions: FormattedPosition[] = [];
    let positionsValue = 0;
    let unrealizedPnlValue = 0;
    const realizedPnlValue = state.cumulativeRealizedPnl;

    for (const position of positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnlValue += position.unrealizedPnl;
    }

    const initialCapital = simBroker.getConfig().initialCapital;
    const pendingOrders = simBroker.getOpenOrders();
    const totalEquity = state.cash + positionsValue;
    const drawdownPct =
      state.peakEquity > 0
        ? ((state.peakEquity - totalEquity) / state.peakEquity) * 100
        : 0;
    const tradeStats = this.calculateTradeAnalytics(
      state.trades,
      initialCapital,
    );

    return resultSuccess({
      cash: state.cash,
      initial_capital: initialCapital,
      positions: formattedPositions,
      positions_count: positions.length,
      positions_value: positionsValue,
      unrealized_pnl_pct: toPercent(unrealizedPnlValue, initialCapital),
      unrealized_pnl: unrealizedPnlValue,
      realized_pnl_pct: toPercent(realizedPnlValue, initialCapital),
      realized_pnl: realizedPnlValue,
      total_equity: totalEquity,
      peak_equity: state.peakEquity,
      drawdown_pct: drawdownPct,
      net_profit: state.cumulativeRealizedPnl,
      trades_count: tradeStats.totalTrades,
      total_trades: tradeStats.totalTrades,
      profitable_trades: tradeStats.profitableTrades,
      losing_trades: tradeStats.losingTrades,
      win_rate: tradeStats.winRate,
      profit_factor: Number.isFinite(tradeStats.profitFactor)
        ? tradeStats.profitFactor
        : null,
      avg_win: tradeStats.avgWin,
      avg_loss: tradeStats.avgLoss,
      largest_win: tradeStats.largestWin,
      largest_loss: tradeStats.largestLoss,
      average_trade_return: tradeStats.averageTradeReturn,
      expectancy: tradeStats.expectancy,
      pending_orders: pendingOrders,
      pending_orders_count: pendingOrders.length,
      trades: state.trades,
    });
  }

  private backtestGetPosition(
    simBroker: SimBroker,
    symbol?: string,
  ): NodeResult {
    const positions = symbol
      ? [simBroker.getPosition(symbol)].filter(
          (position): position is Position => position !== null,
        )
      : Object.values(simBroker.getPortfolioState().positions);

    return resultSuccess(shapePositionQuery(positions));
  }

  private backtestUpdateMTM(
    simBroker: SimBroker,
    symbol?: string,
    bar?: Bar | null,
    prices?: Record<string, number> | null,
  ): NodeResult {
    if (!(prices && Object.keys(prices).length > 0) && !(symbol && bar)) {
      return createErrorOutput(
          "Provide either 'prices' map or both 'symbol' and 'currentBar' for update_mtm",
        );
    }
    return this.backtestGetAll(simBroker);
  }

  private backtestGetCash(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    return createSuccessOutput({
        cash: state.cash,
        buying_power: state.cash - state.reservedCash,
        initial_capital: simBroker.getConfig().initialCapital,
      });
  }

  private backtestGetEquity(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positionsValue = Object.values(state.positions).reduce(
      (sum, p) => sum + p.marketValue,
      0,
    );
    const totalEquity = state.cash + positionsValue;
    const peak = state.peakEquity;
    const drawdownPct = peak > 0 ? ((peak - totalEquity) / peak) * 100 : 0;

    return resultSuccess({
      total_equity: totalEquity,
      cash: state.cash,
      positions_value: positionsValue,
      initial_capital: simBroker.getConfig().initialCapital,
      return_pct:
        ((totalEquity - simBroker.getConfig().initialCapital) /
          simBroker.getConfig().initialCapital) *
        100,
      peak_equity: peak,
      drawdown_pct: drawdownPct,
    });
  }

  private backtestGetTrades(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const trades = simBroker.getTrades();
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return resultSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: state.cumulativeRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }

  // ============== BROKER HELPERS ==============

  private brokerGetAll(pm: PortfolioManager, baseCurrency: string): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    return resultSuccess({
      ...this.getPortfolioSummaryFromState(state),
      fees_by_asset: pm.getFeesByAsset(),
      drawdown_pct:
        state.peakEquity > 0
          ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
          : 0,
      trades: state.trades,
    });
  }

  private getPortfolioSummary(
    pm: PortfolioManager,
    baseCurrency: string,
  ): Record<string, any> {
    return { ...this.getPortfolioSummaryFromState(pm.getPortfolioState(baseCurrency)), fees_by_asset: pm.getFeesByAsset() };
  }

  private getPortfolioSummaryFromState(
    state: BrokerPortfolioState,
  ): Record<string, any> {
    const formattedPositions: FormattedPosition[] = [];
    let positionsValue = 0;
    let unrealizedPnl = 0;

    for (const position of state.positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnl += position.unrealizedPnl;
    }

    const startingEquity = state.startingEquity;
    const tradeStats = this.calculateTradeAnalytics(
      state.trades,
      startingEquity,
    );
    const totalReturn =
      startingEquity && startingEquity > 0
        ? ((state.totalEquity - startingEquity) / startingEquity) * 100
        : undefined;

    return {
      cash: state.cash,
      positions: formattedPositions,
      positions_count: state.positions.length,
      positions_value: positionsValue,
      unrealized_pnl: unrealizedPnl,
      realized_pnl: state.cumulativeRealizedPnl,
      total_equity: state.totalEquity,
      peak_equity: state.peakEquity,
      initial_capital: startingEquity,
      starting_equity: startingEquity,
      total_return: totalReturn,
      net_profit: state.cumulativeRealizedPnl,
      final_portfolio_value: state.totalEquity,
      trades_count: tradeStats.totalTrades,
      total_trades: tradeStats.totalTrades,
      profitable_trades: tradeStats.profitableTrades,
      losing_trades: tradeStats.losingTrades,
      win_rate: tradeStats.winRate,
      profit_factor: Number.isFinite(tradeStats.profitFactor)
        ? tradeStats.profitFactor
        : null,
      avg_win: tradeStats.avgWin,
      avg_loss: tradeStats.avgLoss,
      largest_win: tradeStats.largestWin,
      largest_loss: tradeStats.largestLoss,
      average_trade_return: tradeStats.averageTradeReturn,
      expectancy: tradeStats.expectancy,
      pending_orders: state.pendingOrders,
      pending_orders_count: state.pendingOrders.length,
    };
  }

  private calculateTradeAnalytics(
    trades: BrokerPortfolioState["trades"],
    startingEquity?: number | null,
  ): TradeAnalytics {
    const totalTrades = trades.length;
    let netProfit = 0, profitableTrades = 0, losingTradesCount = 0;
    let totalWins = 0, totalLosses = 0, largestWin = 0, largestLoss = 0;
    for (const trade of trades) {
      const pnl = trade.netPnl;
      netProfit += pnl;
      if (pnl > 0) {
        profitableTrades += 1;
        totalWins += pnl;
        largestWin = Math.max(largestWin, pnl);
      } else if (pnl < 0) {
        losingTradesCount += 1;
        totalLosses += pnl;
        largestLoss = Math.min(largestLoss, pnl);
      }
    }
    const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
    const totalLossesAbs = Math.abs(totalLosses);
    const profitFactor = totalLossesAbs > 0 ? totalWins / totalLossesAbs : totalWins > 0 ? Infinity : 0;
    const avgWin = profitableTrades > 0 ? totalWins / profitableTrades : 0;
    const avgLoss = losingTradesCount > 0 ? totalLosses / losingTradesCount : 0;
    const averageTradeReturn = totalTrades > 0 && startingEquity && startingEquity > 0
      ? (netProfit / startingEquity) * 100 / totalTrades : 0;

    return {
      netProfit,
      totalTrades,
      profitableTrades,
      losingTrades: losingTradesCount,
      winRate,
      profitFactor,
      avgWin,
      avgLoss,
      largestWin,
      largestLoss,
      averageTradeReturn,
      expectancy: totalTrades > 0 ? netProfit / totalTrades : 0,
    };
  }

  private brokerGetPosition(
    pm: PortfolioManager,
    symbols: string[],
  ): NodeResult {
    return resultSuccess(pm.getPositionQuery(symbols));
  }

  private brokerGetTrades(pm: PortfolioManager): NodeResult {
    const state = pm.getPortfolioState();
    const trades = pm.getTrades();
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return resultSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: state.cumulativeRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }
}

