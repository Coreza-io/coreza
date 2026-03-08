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
import { SimBroker, Position } from "../../services/simBroker";
import { PortfolioManager } from "../../services/PortfolioManager";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import { Bar } from "../../services/simBroker/interfaces";
import { parseBar, parsePrices, toPercent } from "../../utils/barParser";
import { formatPositionWithPnlPercent } from "../../utils/portfolioHelpers";
import { isOurOrder } from "../../utils/orderIdempotency";

// Key prefix for SimBroker cache (shared with BacktestExecutor)
const SIM_BROKER_KEY_PREFIX = "simBroker:";

/**
 * Unified PortfolioExecutor — handles both backtest (SimBroker) and live broker modes.
 *
 * Backtest mode: Delegates to the SimBroker instance cached by BacktestExecutor
 * Broker mode: Delegates to PortfolioManager for live Binance Spot data
 */
export class PortfolioExecutor implements INodeExecutor {
  readonly category = "Portfolio";

  // Local ownership cache: avoids Redis round-trip on every fill event (5-min TTL)
  private static ownershipCache = new Map<string, { ours: boolean; expiry: number }>();

  private async checkOwnership(id: string): Promise<boolean> {
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

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
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

  private async executeBacktestMode(
    params: any,
    _context: any,
  ): Promise<NodeResult> {
    const backtestId = params.backtest_id;
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
    const symbol = params.symbol;
    const currentBar = parseBar(params.current_bar);
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
    context: any,
  ): Promise<NodeResult> {
    const userId = context?.userId;
    if (!userId) {
      return toNodeResult(
        createErrorOutput("User ID required for broker mode"),
      );
    }

    const runId = context?.runId || context?.workflow_id;

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

    // if (!pm.isBootstrapped()) {
    //   return toNodeResult(createSuccessOutput({
    //         ...this.getPortfolioSummary(pm, baseCurrency),
    //       }),);
    // }

    switch (operation) {
      case "get_portfolio":
        return this.brokerGetAll(pm, baseCurrency);
      case "update_portfolio": {
        // Explicit fill fields: symbol, side, quantity, price, commission, fill_id
        const fillSymbol = params.symbol?.trim().toUpperCase();
        const side = params.side?.trim().toUpperCase();
        const rawQuantity = parseFloat(params.quantity);
        const price = parseFloat(params.price);
        const commission = parseFloat(params.commission || "0");
        const fillId = params.fill_id?.trim() || undefined;

        if (!fillSymbol) {
          return toNodeResult(
            createErrorOutput("symbol is required for update_portfolio"),
          );
        }
        if (!side || (side !== "BUY" && side !== "SELL")) {
          return toNodeResult(createErrorOutput("side must be BUY or SELL"));
        }
        if (isNaN(rawQuantity) || rawQuantity === 0) {
          return toNodeResult(
            createErrorOutput("quantity must be a non-zero number"),
          );
        }
        if (isNaN(price) || price <= 0) {
          return toNodeResult(
            createErrorOutput("price must be a positive number"),
          );
        }

        // Order ownership verification: if fill_id provided, check Redis reverse index
        if (fillId) {
          const ownership = await isOurOrder(fillId);
          if (!ownership.ours) {
            console.log(
              `[PortfolioExecutor] Skipping fill for unknown order: ${fillId}`,
            );
            return toNodeResult(
              createSuccessOutput({
                updated: false,
                skipped: true,
                reason: "unknown_order",
                fill_id: fillId,
                message: "Order was not placed by this system — fill skipped",
                ...this.getPortfolioSummary(pm, baseCurrency),
              }),
            );
          }
        }

        const normalizedQuantity = Math.abs(rawQuantity);
        const quantity =
          side === "SELL" ? -normalizedQuantity : normalizedQuantity;

        const fillResult = pm.applyFill(
          { symbol: fillSymbol, quantity, price, commission },
          baseCurrency,
          fillId,
        );

        if (!fillResult.applied) {
          return toNodeResult(
            createSuccessOutput({
              updated: false,
              skipped: true,
              reason: fillResult.reason,
              fill_id: fillId,
              message: `Fill skipped: ${fillResult.reason}`,
              ...this.getPortfolioSummary(pm, baseCurrency),
            }),
          );
        }

        return toNodeResult(
          createSuccessOutput({
            updated: true,
            fill_applied: {
              symbol: fillSymbol,
              side,
              quantity: normalizedQuantity,
              signedQuantity: quantity,
              price,
              commission,
              fill_id: fillId,
            },
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }
      case "update_mtm": {
        // Valuation loop: update current prices without changing cash/holdings
        const mtmPrice = parseFloat(params.price);
        if (symbols.length === 0 || isNaN(mtmPrice) || mtmPrice <= 0) {
          return toNodeResult(
            createErrorOutput("Provide symbol and price for update_mtm"),
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
      case "get_cash":
        return this.brokerGetCash(pm, baseCurrency);
      case "get_equity":
        return this.brokerGetEquity(pm, baseCurrency);
      case "get_trades":
        return this.brokerGetTrades(pm);
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== BACKTEST HELPERS ==============

  private backtestGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions = positions.map((p) =>
      formatPositionWithPnlPercent(p),
    );
    const positionsValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const initialCapital = simBroker.getConfig().initialCapital;
    const unrealizedPnlValue = positions.reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0,
    );
    const realizedPnlValue = positions.reduce(
      (sum, p) => sum + p.realizedPnl,
      0,
    );

    return toNodeResult(
      createSuccessOutput({
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
        pending_orders: state.pendingOrders,
        pending_orders_count: state.pendingOrders.length,
        trades: state.trades,
        trades_count: state.trades.length,
      }),
    );
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

    return toNodeResult(
      createSuccessOutput({
        has_position: !!position,
        position: formattedPosition,
        symbol,
        quantity: position?.quantity || 0,
        side: position?.side || null,
        avg_entry_price: position?.avgEntryPrice || 0,
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
      }),
    );
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
          "Provide either 'prices' map or both 'symbol' and 'current_bar' for update_mtm",
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

    return toNodeResult(
      createSuccessOutput({
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
      }),
    );
  }

  private backtestGetTrades(simBroker: SimBroker): NodeResult {
    const trades = simBroker.getTrades();
    const totalRealizedPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
    return toNodeResult(
      createSuccessOutput({
        trades,
        count: trades.length,
        total_realized_pnl: totalRealizedPnl,
        winning_trades: trades.filter((t) => t.netPnl > 0).length,
        losing_trades: trades.filter((t) => t.netPnl < 0).length,
      }),
    );
  }

  // ============== BROKER HELPERS ==============

  private brokerGetAll(pm: PortfolioManager, baseCurrency: string): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    return toNodeResult(
      createSuccessOutput({
        ...this.getPortfolioSummary(pm, baseCurrency),
        drawdown_pct:
          state.peakEquity > 0
            ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
            : 0,
        trades: state.trades,
      }),
    );
  }

  private getPortfolioSummary(
    pm: PortfolioManager,
    baseCurrency: string,
  ): Record<string, any> {
    const state = pm.getPortfolioState(baseCurrency);
    const positions = state.positions;
    const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);

    return {
      cash: state.cash,
      positions: positions.map((p) => formatPositionWithPnlPercent(p)),
      positions_count: positions.length,
      positions_value: positionsValue,
      unrealized_pnl: positions.reduce((s, p) => s + p.unrealizedPnl, 0),
      realized_pnl: positions.reduce((s, p) => s + p.realizedPnl, 0),
      total_equity: state.totalEquity,
      peak_equity: state.peakEquity,
      trades_count: state.trades.length,
    };
  }

  private brokerGetPosition(
    pm: PortfolioManager,
    symbols: string[],
  ): NodeResult {
    if (symbols.length === 0) {
      // No symbol provided: return all tracked positions
      const positions = pm.getPositions();
      return toNodeResult(
        createSuccessOutput({
          positions: positions.map((p) => formatPositionWithPnlPercent(p)),
          positions_count: positions.length,
        }),
      );
    }

    if (symbols.length === 1) {
      // Single symbol: keep backward-compatible flat output
      const symbol = symbols[0];
      const position = pm.getPosition(symbol);
      const costBasis = position
        ? Math.abs(position.avgEntryPrice * position.quantity)
        : 0;

      return toNodeResult(
        createSuccessOutput({
          has_position: !!position,
          position: position ? formatPositionWithPnlPercent(position) : null,
          symbol,
          quantity: position?.quantity || 0,
          side: position?.side || null,
          avg_entry_price: position?.avgEntryPrice || 0,
          current_price: position?.currentPrice || 0,
          unrealized_pnl_pct: toPercent(
            position?.unrealizedPnl || 0,
            costBasis,
          ),
          unrealized_pnl: position?.unrealizedPnl || 0,
          realized_pnl_pct: toPercent(position?.realizedPnl || 0, costBasis),
          realized_pnl: position?.realizedPnl || 0,
          market_value: position?.marketValue || 0,
        }),
      );
    }

    // Multiple symbols: return array of positions
    const results = symbols.map((symbol) => {
      const position = pm.getPosition(symbol);
      const costBasis = position
        ? Math.abs(position.avgEntryPrice * position.quantity)
        : 0;
      return {
        has_position: !!position,
        position: position ? formatPositionWithPnlPercent(position) : null,
        symbol,
        quantity: position?.quantity || 0,
        side: position?.side || null,
        avg_entry_price: position?.avgEntryPrice || 0,
        current_price: position?.currentPrice || 0,
        unrealized_pnl_pct: toPercent(position?.unrealizedPnl || 0, costBasis),
        unrealized_pnl: position?.unrealizedPnl || 0,
        realized_pnl_pct: toPercent(position?.realizedPnl || 0, costBasis),
        realized_pnl: position?.realizedPnl || 0,
        market_value: position?.marketValue || 0,
      };
    });

    return toNodeResult(
      createSuccessOutput({
        positions: results,
        positions_count: results.length,
      }),
    );
  }

  private brokerGetCash(
    pm: PortfolioManager,
    baseCurrency: string,
  ): NodeResult {
    return toNodeResult(
      createSuccessOutput({
        cash: pm.getCash(),
        buying_power: pm.getCash()[baseCurrency] || 0,
      }),
    );
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
    return toNodeResult(
      createSuccessOutput({
        total_equity: state.totalEquity,
        cash_base: pm.getCash()[baseCurrency] || 0,
        positions_value: positionsValue,
        peak_equity: state.peakEquity,
        drawdown_pct:
          state.peakEquity > 0
            ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
            : 0,
      }),
    );
  }

  private brokerGetTrades(pm: PortfolioManager): NodeResult {
    const trades = pm.getTrades();
    const totalRealizedPnl = trades.reduce((s, t) => s + t.netPnl, 0);
    return toNodeResult(
      createSuccessOutput({
        trades,
        count: trades.length,
        total_realized_pnl: totalRealizedPnl,
        winning_trades: trades.filter((t) => t.netPnl > 0).length,
        losing_trades: trades.filter((t) => t.netPnl < 0).length,
      }),
    );
  }
}
