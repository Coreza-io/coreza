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

/**
 * Unified PortfolioExecutor — handles both backtest (SimBroker) and live broker modes.
 *
 * Backtest mode: Delegates to the SimBroker instance cached by BacktestExecutor
 * Broker mode: Delegates to PortfolioManager for live broker data
 */
type BrokerPortfolioState = ReturnType<PortfolioManager["getPortfolioState"]>;

export class PortfolioExecutor implements INodeExecutor {
  readonly category = "Portfolio";
  // Backtest mode is fully sync. Broker mode is async, but compiled execution
  // only calls this node in backtest mode and the adapter safely rejects Promise returns.
  readonly syncCapable = true;

  // Local ownership cache: avoids Redis round-trip on every fill event (5-min TTL)
  private static ownershipCache = new Map<
    string,
    { ours: boolean; expiry: number }
  >();
  private static ownershipLookupCount = 0;

  private async checkOwnership(id: string): Promise<boolean> {
    // Periodic sweep every 1000 lookups to prevent unbounded memory growth
    if (++PortfolioExecutor.ownershipLookupCount % 1000 === 0) {
      const now = Date.now();
      for (const [key, val] of PortfolioExecutor.ownershipCache) {
        if (val.expiry < now) PortfolioExecutor.ownershipCache.delete(key);
      }
    }

    const cached = PortfolioExecutor.ownershipCache.get(id);
    if (cached && cached.expiry > Date.now()) return cached.ours;

    const result = await isOurOrder(id);
    PortfolioExecutor.ownershipCache.set(id, {
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

    const runId = context.runId || context.workflowId;
    if (!runId) {
      return toNodeResult(
        createErrorOutput(
          "runId is required for broker mode — cannot use workflowId as fallback",
        ),
      );
    }

    // Get or create PortfolioManager
    const pm = PortfolioManager.getInstance(userId, runId);

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

      const cashBalance = parseFloat(params.cash_balance);
      if (baseCurrency && !isNaN(cashBalance) && cashBalance >= 0) {
        pm.initializePortfolio(baseCurrency, cashBalance);
        return toNodeResult(
          createSuccessOutput({
            message: "Portfolio created with explicit cash balance",
            created: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }

      return toNodeResult(
        createErrorOutput(
          "cash_balance must be a non-negative number for create_portfolio",
        ),
      );
    }

    switch (operation) {
      // ============== NEW v2 OPERATIONS ==============
      case "register_order_intent":
        return this.brokerRegisterOrderIntent(pm, params);
      case "sync_order_event":
        return this.brokerSyncOrderEvent(pm, params, baseCurrency);
      case "get_portfolio":
        return this.brokerGetAll(pm, baseCurrency);
      case "update_mtm": {
        // Accept marketPrice (new)
        const mtmPrice = parseFloat(params.marketPrice ?? params.price);
        if (symbols.length === 0 || isNaN(mtmPrice) || mtmPrice <= 0) {
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

        const cancelResult = pm.cancelOrder(cancelOrderId);
        return toNodeResult(
          createSuccessOutput({
            removed: cancelResult.removed,
            cancelledOrder: cancelResult.order || null,
            pendingOrdersCount: pm.getPendingOrders().length,
          }),
        );
      }
      case "get_pending_orders": {
        const PendingOrders = pm.getPendingOrders();
        const filterSymbol = params.symbol?.trim().toUpperCase();
        const filtered = filterSymbol
          ? PendingOrders.filter((o) => o.symbol === filterSymbol)
          : PendingOrders;

        return toNodeResult(
          createSuccessOutput({
            pendingOrders: filtered,
            pendingOrdersCount: filtered.length,
          }),
        );
      }
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== NEW v2 BROKER OPERATION HANDLERS ==============

  private brokerRegisterOrderIntent(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    try {
      const brokerOrderId = params.brokerOrderId;
      const clientOrderId = params.clientOrderId;
      const symbol = params.symbol;
      const side = params.side;
      const orderType = params.orderType;
      const origQty = params.origQty;
      const timeInForce = params.timeInForce;
      const limitPrice = params.limitPrice;
      const stopPrice = params.stopPrice;
      const trailPercent = params.trailPercent;
      const trailPrice = params.trailPrice;
      const status = params.status;
      const result = pm.registerOrderIntent({
        brokerOrderId,
        clientOrderId,
        symbol,
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
          registered: result.registered,
          order: result.order,
          pendingOrdersCount: pm.getPendingOrders().length,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private async brokerEnsureOwnedOrder(
    brokerOrderId?: string,
    clientOrderId?: string,
  ): Promise<{ ours: boolean }> {
    if (!brokerOrderId && !clientOrderId) {
      return { ours: true };
    }

    const isOurs =
      (brokerOrderId && (await this.checkOwnership(brokerOrderId))) ||
      (clientOrderId && (await this.checkOwnership(clientOrderId)));

    return { ours: !!isOurs };
  }

  private async brokerSyncOrderEvent(
    pm: PortfolioManager,
    params: any,
  ): Promise<NodeResult> {
    try {
      const {
        baseCurrency,
        symbol,
        brokerOrderId,
        clientOrderId,
        status,
        filledQty,
        positionQty,
        avgFillPrice,
        feeAmount,
        feeAsset,
      } = params;

      let netFilledQty = positionQty ?? filledQty;

      const { ours } = await this.brokerEnsureOwnedOrder(
        brokerOrderId,
        clientOrderId,
      );
      if (!ours) {
        return toNodeResult(
          createSuccessOutput({
            skipped: true,
            reason: "unknown_order",
            brokerOrderId,
            clientOrderId,
          }),
        );
      }

      // 1. Order update (if status provided)
      if (status) {
        const resolvedBrokerOrderId =
          brokerOrderId ?? pm.resolveOrderIdByClientId(clientOrderId ?? "");

        if (!resolvedBrokerOrderId) {
          console.warn(
            `[PortfolioExecutor] sync_order_event: order update skipped due to missing broker_order_id and unresolved client_order_id=${clientOrderId}`,
          );
        } else {
          pm.applyOrderUpdate({
            brokerOrderId: resolvedBrokerOrderId,
            clientOrderId,
            symbol,
            status,
            filledQty,
            avgFillPrice,
            feeAmount,
            feeAsset,
          });
        }
      }

      // 3. Position reconcile (if positionQty provided — Alpaca fee-in-kind adjustment)

      pm.applyPositionUpdate({
        symbol,
        netFilledQty,
        avgEntryPrice: avgFillPrice,
        currentPrice: avgFillPrice,
      });

      const { quoteAsset } = this.parseInstrument(
        input.symbol,
        input.baseCurrency,
      );
      const effectiveQuoteAsset = quoteAsset ?? input.baseCurrency;

      // Cash/balance adjustment
      this.adjustQuoteBalance(
        effectiveQuoteAsset,
        order.side,
        order.avgFillPrice || 0,
        now,
      );

      // Fee adjustment (supports fee in any asset)
      if (input.feeAmount > 0) {
        const feeBalanceAsset = input.feeAsset ?? effectiveQuoteAsset;
        this.adjustFeeBalance(feeBalanceAsset, input.feeAmount, now);
      }

      // Update peak equity
      this.updatePeakEquity(input.baseCurrency);

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
    const pendingOrders = simBroker.getPendingOrders();

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
      ? Math.abs(position.avgEntryPrice * position.quantity)
      : 0;

    return leanSuccess({
      has_position: !!position,
      position: formattedPosition,
      symbol,
      quantity: position?.quantity || 0,
      side: position?.side || null,
      avgEntryPrice: position?.avgEntryPrice || 0,
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
    let realizedPnl = 0;

    for (const position of state.positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnl += position.unrealizedPnl;
      realizedPnl += position.realizedPnl;
    }

    return {
      cash: state.cash,
      positions: formattedPositions,
      positions_count: state.positions.length,
      positions_value: positionsValue,
      unrealized_pnl: unrealizedPnl,
      realized_pnl: realizedPnl,
      total_equity: state.totalEquity,
      peak_equity: state.peakEquity,
      trades_count: state.trades.length,
      pending_orders: state.pendingOrders,
      pending_orders_count: state.pendingOrders.length,
    };
  }

  private brokerGetPosition(
    pm: PortfolioManager,
    symbols: string[],
  ): NodeResult {
    if (symbols.length === 0) {
      // No symbol provided: return all tracked positions
      const positions = pm.getPositions();
      return leanSuccess({
        positions: positions.map((p) => formatPositionWithPnlPercent(p)),
        positions_count: positions.length,
      });
    }

    if (symbols.length === 1) {
      // Single symbol: keep backward-compatible flat output
      const symbol = symbols[0];
      const position = pm.getPosition(symbol);

      return leanSuccess({
        position,
      });
    }

    // Multiple symbols: return array of positions
    const results = symbols.map((symbol) => {
      const position = pm.getPosition(symbol);
      return {
        position,
      };
    });

    return leanSuccess({
      positions: results,
      positions_count: results.length,
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
