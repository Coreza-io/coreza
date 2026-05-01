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

import { createHash } from "crypto";
import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { SimBroker, Position } from "../../backtest/simBroker";
import { PortfolioManager } from "../../simulation/PortfolioManager";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  leanSuccess,
} from "../../utils/normalizeOutput";
import { Bar } from "../../backtest/simBroker/interfaces";
import { parseBar, parsePrices, toPercent } from "../../utils/barParser";
import {
  FormattedPosition,
  formatPositionWithPnlPercent,
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
  symbol?: string;
  qty?: string | number;
  side?: string;
  type?: string;
  status?: string;
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

      const mode = params.mode;

      if (mode === "backtest") {
        return this.executeBacktestMode(params, context);
      } else if (mode === "broker") {
        // if (node.values?.credential_id) {
        //   params.credential_id = node.values.credential_id;
        // }
        return this.executeBrokerMode(params, context);
      }

      return toNodeResult(createErrorOutput(`Unknown portfolio mode: ${mode}`));
    } catch (error) {
      console.error("[PortfolioExecutor] Execution failed:", error);
      return toNodeResult(createErrorOutput(error));
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
      return toNodeResult(createErrorOutput("backtest_id is required"));
    }

    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    const simBroker = PortfolioExecutor.simBrokerCache.get(key);
    if (!simBroker) {
      return toNodeResult(
        createErrorOutput(
          `No SimBroker found for backtest ${backtestId}. Ensure BacktestInit ran first.`,
        ),
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
        simBroker.onBar(symbol, currentBar);
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
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== BROKER MODE ==============

  private async executeBrokerMode(
    params: any,
    context?: NodeExecutionContext,
  ): Promise<NodeResult> {
    const userId = context?.userId;
    if (!userId) {
      return toNodeResult(
        createErrorOutput("User ID required for broker mode"),
      );
    }

    const executionId = context.executionId || context.workflowId;
    if (!executionId) {
      return toNodeResult(
        createErrorOutput(
          "executionId is required for broker mode — cannot use workflowId as fallback",
        ),
      );
    }

    // Get or create PortfolioManager
    const pm = PortfolioManager.getInstance(userId, executionId);

    const symbols = this.parseSymbols(params.symbol);
    const operation = params.operation || "get_portfolio";
    const baseCurrency = params.base_currency || "USDT";

    if (operation === "create_portfolio") {
      if (pm.isBootstrapped()) {
        return toNodeResult(
          createSuccessOutput({
            message: "Portfolio already initialized",
            already_created: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
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

      return toNodeResult(
        createSuccessOutput({
          message: "Portfolio created with explicit balance and position data",
          created: true,
          ...this.getPortfolioSummary(pm, baseCurrency),
        }),
      );
    }

    if (operation === "sync_broker_state") {
      return this.brokerSyncState(pm, params, context);
    }

    switch (operation) {
      // ============== NEW v2 OPERATIONS ==============
      case "register_order_intent":
        return this.brokerRegisterOrderIntent(pm, params);
      case "sync_order_event":
        return this.brokerSyncOrderEvent(pm, params, context);
      case "get_portfolio":
        return this.brokerGetAll(pm, baseCurrency);
      case "update_mtm": {
        // Accept marketPrice (new)
        const mtmPrice = toNumber(params.marketPrice ?? params.price);
        if (symbols.length === 0 || mtmPrice === undefined || mtmPrice <= 0) {
          return toNodeResult(
            createErrorOutput("Provide symbol and marketPrice for update_mtm"),
          );
        }

        const priceMap: Record<string, number> = {};
        for (const sym of symbols) {
          priceMap[sym] = mtmPrice;
        }

        pm.updateMarketPrices(priceMap, baseCurrency);
        return toNodeResult(
          createSuccessOutput({
            updated: true,
            prices_updated: priceMap,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }
      case "get_position":
        return this.brokerGetPosition(pm, symbols);
      case "get_trades":
        return this.brokerGetTrades(pm);
      case "cancel_order": {
        const cancelOrderId = params.broker_order_id;
        if (!cancelOrderId) {
          return toNodeResult(
            createErrorOutput(
              "broker_order_id (or fill_id) is required for cancel_order",
            ),
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

        if (params.broker === "binance" && params.credential_id) {
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
        return toNodeResult(
          createSuccessOutput({
            removed: cancelResult.removed,
            cancelledOrder: cancelResult.order || null,
            isAlgo: params.isAlgo === true || isAlgoOrder,
          }),
        );
      }
      case "get_open_algo_orders": {
        if (params.broker !== "binance") {
          return toNodeResult(
            createErrorOutput(
              "get_open_algo_orders currently supports broker=binance only",
            ),
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

        return toNodeResult(createSuccessOutput(result || {}));
      }
      case "get_all_algo_orders": {
        if (params.broker !== "binance") {
          return toNodeResult(
            createErrorOutput(
              "get_all_algo_orders currently supports broker=binance only",
            ),
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

        return toNodeResult(createSuccessOutput(result || {}));
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

        return toNodeResult(
          createSuccessOutput({
            openOrders: filteredOpenOrders,
            algoOrders: filteredAlgoOrders,
          }),
        );
      }
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
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
        node_type: broker,
        subCategory: broker,
        values: {
          operation,
          ...params,
        },
      } as WorkflowNode & { subCategory?: string },
      {},
      context,
    );

    if (!result.success) {
      throw new Error(result.error || `Broker operation ${operation} failed`);
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
        return toNodeResult(
          createErrorOutput(
            "sync_from_broker currently supports broker=alpaca only",
          ),
        );
      }

      if (!params.credential_id) {
        return toNodeResult(
          createErrorOutput(
            "credential_id is required when sync_from_broker is enabled",
          ),
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
      const margin = toNumber(account.multiplier);
      const equity = toNumber(account.equity);
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
          orderType: order.type,
          status: order.status,
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

      return toNodeResult(
        createSuccessOutput({
          environment: brokerParams.environment,
          cash,
          currency: baseCurrency,
          buyingPower,
          margin,
          initialMargin,
          equity,
          positions: syncedPositions,
          openOrders: syncedOrders,
        }),
      );
    } catch (error: any) {
      return toNodeResult(
        createErrorOutput(error?.message || "Failed to sync broker state"),
      );
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

      return toNodeResult(
        createSuccessOutput({
          order: result.order,
          pendingOrdersCount: pm.getOpenOrders().length,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
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

  // Tracks cumulative filled qty per order for delta computation
  private orderFillState = new Map<string, number>();

  private computeFillDelta(orderId: string, currentFilledQty: number): number {
    const prev = this.orderFillState.get(orderId) || 0;
    if (currentFilledQty <= prev) return 0;
    const delta = currentFilledQty - prev;
    this.orderFillState.set(orderId, currentFilledQty);
    return delta;
  }

  private buildDeterministicEventId(parts: Record<string, any>): string {
    const payload = Object.values(parts).map(String).join("|");
    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  private buildFillStreamEvent(opts: {
    context: NodeExecutionContext;
    params: any;
    symbol: string;
    side: string;
    orderId?: string;
    executionId?: string;
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

    const fillId =
      opts.executionId ||
      this.buildDeterministicEventId({
        user_id: opts.context.userId,
        broker: opts.params.broker || "binance",
        symbol: opts.symbol,
        order_id: opts.orderId,
        side: opts.side,
        fill_qty_delta: opts.filledQty,
        fill_price: opts.fillPrice,
        event_time: eventTime,
      });

    return {
      fill_id: fillId,
      user_id: opts.context.userId,
      workflow_id: opts.context.workflowId,
      execution_id: opts.context.executionId,
      broker: opts.params.broker || "binance",
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
      timeInForce: opts.timeInForce,
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
    const tradeStats = this.calculateTradeAnalytics(
      state.trades,
      state.startingEquity,
    );
    const balances = pm.getCash() as Record<string, unknown>;
    const baseCashRaw =
      (meta.baseCurrency && balances
        ? balances[meta.baseCurrency]
        : undefined) ?? 0;
    const baseCash =
      typeof baseCashRaw === "number" ? baseCashRaw : Number(baseCashRaw) || 0;

    return {
      user_id: meta.userId,
      workflow_id: meta.workflowId,
      execution_id: meta.runId,
      broker: meta.broker,
      credential_id: meta.credentialId,
      snapshot_at: new Date().toISOString(),
      base_currency: meta.baseCurrency,
      cash: baseCash,
      equity: state.totalEquity,
      realized_pnl: tradeStats.netProfit,
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
        context?.executionMode !== "live" ||
        !context?.userId ||
        !context?.workflowId
      ) {
        return toNodeResult(
          createSuccessOutput({
            algo: true,
            algoId,
            algoStatus,
            orderId: orderId ?? null,
            persisted: false,
          }),
        );
      }

      const event: FillStreamEvent = {
        fill_id: algoId ? `algo:${algoId}` : "",
        algo_id: algoId,
        user_id: context.userId,
        workflow_id: context.workflowId,
        execution_id: context.executionId,
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

      return toNodeResult(
        createSuccessOutput({
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
        }),
      );
    } catch (err: any) {
      fillLogger.warn({ err }, "brokerSyncAlgoUpdate failed");
      return toNodeResult(
        createErrorOutput(err?.message || "algo_update sync failed"),
      );
    }
  }

  private async brokerSyncOrderEvent(
    pm: PortfolioManager,
    params: any,
    context?: NodeExecutionContext,
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
            broker: params.broker || "binance",
            credential_id: params.credential_id,
            workflow_id: context?.workflowId,
          },
          "binance listen key expired event received",
        );
        let reconciliation: any = null;
        if (params.broker === "binance" && params.credential_id) {
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
        return toNodeResult(
          createSuccessOutput({
            acknowledged: true,
            reconciliation,
          }),
        );
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

      const filledQty = toNumber(params.filledQty);
      const origQty = toNumber(params.origQty);
      const positionQty = toNumber(params.positionQty);
      const avgFillPrice = toNumber(params.avgFillPrice);
      const feeAmount = toNumber(params.feeAmount);
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
      if (!ours) {
        return toNodeResult(
          createSuccessOutput({
            skipped: true,
            reason: "unknown_order",
            normalizedBrokerId,
            clientOrderId,
          }),
        );
      }

      // 1. Order update (if status provided)
      if (status) {
        const resolvedorderId =
          normalizedBrokerId ??
          pm.resolveOrderIdByClientId(clientOrderId ?? "");

        if (!resolvedorderId) {
          console.warn(
            `[PortfolioExecutor] sync_order_event: order update skipped due to missing broker_order_id and unresolved client_order_id=${clientOrderId}`,
          );
        } else {
          pm.applyOrderUpdate({
            orderId: resolvedorderId,
            clientOrderId,
            symbol,
            side,
            origQty,
            orderType: params.orderType,
            timeInForce: params.timeInForce,
            limitPrice,
            stopPrice,
            trailPercent,
            trailPrice,
            status,
            filledQty,
            avgFillPrice,
            feeAmount,
            feeAsset,
            _seq: seq,
          });
        }
      }

      // 2. Record closed trade (must run before position update which may delete the position)
      let finalizedTrade:
        | import("../../backtest/simBroker/interfaces").Trade
        | null = null;
      const normalizedStatus = String(status ?? "")
        .trim()
        .toLowerCase();
      const hasFillEvent =
        filledQty != null && filledQty > 0 && avgFillPrice != null;
      const isTerminalStatus = TERMINAL_ORDER_STATUSES.has(normalizedStatus);
      const shouldApplyTrade =
        Boolean(params.side) &&
        Boolean(normalizedBrokerId) &&
        (hasFillEvent || (isTerminalStatus && (filledQty ?? 0) <= 0));
      if (shouldApplyTrade) {
        const tradeResult = pm.applyTrade(
          {
            orderId: normalizedBrokerId,
            clientOrderId,
            executionId: params.executionId,
            symbol,
            side: params.side,
            filledQty,
            fillPrice: avgFillPrice,
            feeAmount: feeAmount ?? 0,
            status: normalizedStatus,
            baseCurrency,
          },
          new Date().toISOString(),
        );

        if (tradeResult.kind === "skipped") {
          fillLogger.debug(
            { symbol, orderId, reason: tradeResult.reason },
            "trade aggregation skipped",
          );
        } else if (tradeResult.kind === "pendingUpdate") {
          fillLogger.debug(
            {
              symbol,
              normalizedBrokerId,
              accumulatedQty: tradeResult.pending.accumulatedQuantity,
              status: tradeResult.pending.status,
            },
            "trade aggregation pending update",
          );
        } else {
          finalizedTrade = tradeResult.trade;
          fillLogger.info(
            {
              symbol,
              normalizedBrokerId,
              quantity: tradeResult.trade.quantity,
              status,
            },
            "trade aggregation finalized",
          );
        }

        // Persist closed trade to live_trades table
        if (
          finalizedTrade &&
          context?.executionMode === "live" &&
          context?.userId &&
          context?.workflowId
        ) {
          void LiveTradeRepository.insert({
            user_id: context.userId,
            workflow_id: context.workflowId,
            execution_id: context.executionId,
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

      // 3. Position reconcile (if positionQty provided — Alpaca fee-in-kind adjustment)

      pm.applyPositionUpdate({
        symbol,
        filledQty,
        avgFillPrice,
        side: params.side,
        normalizedBrokerId,
        positionQty,
        currentPrice: avgFillPrice,
      });

      // Cash + fee + peak equity adjustment (delegated to PM)
      pm.applyFillAccounting({
        symbol,
        side: params.side,
        fillPrice: avgFillPrice ?? 0,
        fillQty: filledQty ?? 0,
        feeAmount,
        feeAsset,
        baseCurrency,
      });

      // 5. Buffer fill for async DB persistence (fire-and-forget)
      if (filledQty && avgFillPrice && orderId) {
        //const fillDeltaQty = this.computeFillDelta(orderId, filledQty);

        if (
          //fillDeltaQty > 0 &&
          filledQty > 0 &&
          context?.executionMode === "live" &&
          context?.userId &&
          context?.workflowId
        ) {
          const event = this.buildFillStreamEvent({
            context,
            params,
            symbol,
            side: params.side,
            orderId: normalizedBrokerId,
            executionId: params.executionId,
            //fillDeltaQty,
            filledQty,
            fillPrice: avgFillPrice,
            fillStatus: params.status,
            feeAmount,
            feeAsset,
            baseCurrency,
            orderType: params.orderType,
            limitPrice: toNumber(params.limitPrice) ?? toNumber(params.price),
            stopPrice: toNumber(params.stopPrice),
            trailPercent: toNumber(params.trailPercent),
            trailPrice: toNumber(params.trailPrice),
            timeInForce: params.timeInForce,
            tag: params.tag || context.nodeId,
          });

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
            runId: context.executionId,
            broker: params.broker || "binance",
            credentialId: params.credential_id,
            baseCurrency,
          });
          void SnapshotCache.upsertLatest(snapshot).catch((err) =>
            fillLogger.warn({ err }, "snapshot cache update failed"),
          );
        }
      }

      return toNodeResult(
        createSuccessOutput({
          ...this.getPortfolioSummary(pm, baseCurrency),
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  // ============== BACKTEST HELPERS ==============

  private backtestGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions: FormattedPosition[] = [];
    let positionsValue = 0;
    let unrealizedPnlValue = 0;
    let realizedPnlValue = 0;

    for (const position of positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnlValue += position.unrealizedPnl;
      realizedPnlValue += position.realizedPnl;
    }

    const initialCapital = simBroker.getConfig().initialCapital;
    const pendingOrders = simBroker.getOpenOrders();

    return leanSuccess({
      cash: state.cash,
      initial_capital: initialCapital,
      positions: formattedPositions,
      positions_count: positions.length,
      positions_value: positionsValue,
      unrealized_pnl_pct: toPercent(unrealizedPnlValue, initialCapital),
      unrealized_pnl: unrealizedPnlValue,
      realized_pnl_pct: toPercent(realizedPnlValue, initialCapital),
      realized_pnl: realizedPnlValue,
      total_equity: state.cash + positionsValue,
      pending_orders: pendingOrders,
      pending_orders_count: pendingOrders.length,
      trades: state.trades,
      trades_count: state.trades.length,
    });
  }

  private backtestGetPosition(
    simBroker: SimBroker,
    symbol?: string,
  ): NodeResult {
    if (!symbol) {
      return toNodeResult(
        createErrorOutput("'symbol' is required for get_position"),
      );
    }
    const position = simBroker.getPosition(symbol);
    const formattedPosition = position
      ? formatPositionWithPnlPercent(position)
      : null;
    const positionCostBasis = position
      ? Math.abs(position.avgFillPrice * position.quantity)
      : 0;

    return leanSuccess({
      has_position: !!position,
      position: formattedPosition,
      symbol,
      quantity: position?.quantity || 0,
      side: position?.side || null,
      avgFillPrice: position?.avgFillPrice || 0,
      current_price: position?.currentPrice || 0,
      unrealized_pnl_pct: toPercent(
        position?.unrealizedPnl || 0,
        positionCostBasis,
      ),
      unrealized_pnl: position?.unrealizedPnl || 0,
      realized_pnl_pct: toPercent(
        position?.realizedPnl || 0,
        positionCostBasis,
      ),
      realized_pnl: position?.realizedPnl || 0,
      market_value: position?.marketValue || 0,
    });
  }

  private backtestUpdateMTM(
    simBroker: SimBroker,
    symbol?: string,
    bar?: Bar | null,
    prices?: Record<string, number> | null,
  ): NodeResult {
    if (!(prices && Object.keys(prices).length > 0) && !(symbol && bar)) {
      return toNodeResult(
        createErrorOutput(
          "Provide either 'prices' map or both 'symbol' and 'currentBar' for update_mtm",
        ),
      );
    }
    return this.backtestGetAll(simBroker);
  }

  private backtestGetCash(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    return toNodeResult(
      createSuccessOutput({
        cash: state.cash,
        buying_power: state.cash,
        initial_capital: simBroker.getConfig().initialCapital,
      }),
    );
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

    return leanSuccess({
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
    const trades = simBroker.getTrades();
    let totalRealizedPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      totalRealizedPnl += trade.netPnl;
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: totalRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }

  // ============== BROKER HELPERS ==============

  private brokerGetAll(pm: PortfolioManager, baseCurrency: string): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    return leanSuccess({
      ...this.getPortfolioSummaryFromState(state),
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
    return this.getPortfolioSummaryFromState(
      pm.getPortfolioState(baseCurrency),
    );
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
      realized_pnl: tradeStats.netProfit,
      total_equity: state.totalEquity,
      peak_equity: state.peakEquity,
      initial_capital: startingEquity,
      starting_equity: startingEquity,
      total_return: totalReturn,
      net_profit: tradeStats.netProfit,
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
    const netProfit = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const winningTrades = trades.filter((trade) => trade.netPnl > 0);
    const losingTrades = trades.filter((trade) => trade.netPnl < 0);
    const profitableTrades = winningTrades.length;
    const losingTradesCount = losingTrades.length;
    const winRate =
      totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;

    const totalWins = winningTrades.reduce(
      (sum, trade) => sum + trade.netPnl,
      0,
    );
    const totalLossesAbs = Math.abs(
      losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0),
    );
    const profitFactor =
      totalLossesAbs > 0
        ? totalWins / totalLossesAbs
        : totalWins > 0
          ? Infinity
          : 0;

    const avgWin = profitableTrades > 0 ? totalWins / profitableTrades : 0;
    const avgLoss =
      losingTradesCount > 0
        ? losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0) /
          losingTradesCount
        : 0;
    const largestWin =
      profitableTrades > 0
        ? Math.max(...winningTrades.map((trade) => trade.netPnl))
        : 0;
    const largestLoss =
      losingTradesCount > 0
        ? Math.min(...losingTrades.map((trade) => trade.netPnl))
        : 0;

    const averageTradeReturn =
      totalTrades > 0
        ? trades.reduce((sum, trade) => {
            if (startingEquity && startingEquity > 0) {
              return sum + (trade.netPnl / startingEquity) * 100;
            }
            return sum;
          }, 0) / totalTrades
        : 0;

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
    let positions;

    if (symbols.length === 0) {
      // All positions
      positions = pm.getPositions();
    } else {
      // One or multiple symbols
      positions = symbols
        .map((symbol) => pm.getPosition(symbol))
        .filter(Boolean); // remove nulls
    }

    return leanSuccess({
      positions: positions.map((p) => formatPositionWithPnlPercent(p)),
      positions_count: positions.length,
    });
  }

  private brokerGetCash(
    pm: PortfolioManager,
    baseCurrency: string,
  ): NodeResult {
    const cash = pm.getCash();
    return leanSuccess({
      cash,
      buying_power: cash[baseCurrency] || 0,
    });
  }

  private brokerGetEquity(
    pm: PortfolioManager,
    baseCurrency: string,
  ): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    const positionsValue = state.positions.reduce(
      (s, p) => s + p.marketValue,
      0,
    );
    return leanSuccess({
      total_equity: state.totalEquity,
      cash_base: pm.getCash()[baseCurrency] || 0,
      positions_value: positionsValue,
      peak_equity: state.peakEquity,
      drawdown_pct:
        state.peakEquity > 0
          ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
          : 0,
    });
  }

  private brokerGetTrades(pm: PortfolioManager): NodeResult {
    const trades = pm.getTrades();
    let totalRealizedPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      totalRealizedPnl += trade.netPnl;
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: totalRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }
}
