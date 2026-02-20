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
import { SimBroker, SimBrokerConfig, Bar, Position, OrderFill, EquityPoint } from "../../services/simBroker";
import { supabase } from "../../config/supabase";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  NormalizeContext,
} from "../../utils/normalizeOutput";

// Key prefix for caching SimBroker instances by backtest id
const SIM_BROKER_KEY_PREFIX = "simBroker:";
const SIM_BROKER_CACHE_KEY = "__simBrokerCache";

export class BacktestExecutor implements INodeExecutor {
  readonly category = "Backtest";
  private simBrokerCache = new Map<string, SimBroker>();

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    // const startTime = Date.now();
    const nodeName = node.name;

    switch (nodeName) {
      case "BacktestInit":
        return this.executeBacktestInit(node, input, context);
      case "BacktestTrade":
        return this.executeBacktestTrade(node, input, context);
      case "BacktestResults":
        return this.executeBacktestResults(node, input, context);
      case "BacktestPortfolio":
        return this.executeBacktestPortfolio(node, input, context);
      default:
        return toNodeResult(
          createErrorOutput(`Unknown backtest node type: ${nodeName}`),
        );
    }
  }

  /**
   * Get or create SimBroker instance from executor cache.
   * We keep one broker per backtest ID so state (cash/positions/orders)
   * is shared across Backtest nodes until cleanup.
   */
  private getSimBroker(
    backtestId: string,
    config?: Partial<SimBrokerConfig>,
  ): SimBroker {
    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    const existing = this.simBrokerCache.get(key);
    if (existing) {
      return existing;
    }

    const simBroker = new SimBroker(backtestId, config);
    this.simBrokerCache.set(key, simBroker);

    return simBroker;
  }

  /** Remove SimBroker instance from cache after backtest completion. */
  private cleanupSimBroker(backtestId: string): void {
    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    this.simBrokerCache.delete(key);
  }

  // ============== BACKTEST INIT ==============
  private async executeBacktestInit(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const userId = context?.userId;
      const workflowId = context?.workflowId;

      if (!userId || !workflowId) {
        return toNodeResult(
          createErrorOutput("User ID and Workflow ID required for backtest"),
        );
      }

      // Parse configuration
      const config: Partial<SimBrokerConfig> = {
        initialCapital: parseFloat(params.initial_capital) || 10000,
        fillModel: params.fill_model || "next_bar_open",
        slippageModel: params.slippage_model || "percentage",
        slippageValue: parseFloat(params.slippage_value) || 0.001,
        commissionModel: params.commission_model || "per_share",
        commissionValue: parseFloat(params.commission_value) || 0.01,
        allowShort:
          params.allow_short === "true" || params.allow_short === true,
      };

      // Create backtest session in Supabase
      const supabaseClient = supabase;
      const { data: backtest, error: insertError } = await supabaseClient
        .from("backtests")
        .insert({
          user_id: userId,
          workflow_id: workflowId,
          name: params.name || `Backtest ${new Date().toISOString()}`,
          description: params.description || null,
          status: "running",
          initial_capital: config.initialCapital,
          commission_rate: config.commissionValue,
          slippage_rate: config.slippageValue,
          start_date:
            params.start_date || new Date().toISOString().split("T")[0],
          end_date: params.end_date || new Date().toISOString().split("T")[0],
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError || !backtest) {
        console.error(
          "[BacktestExecutor] Failed to create backtest session:",
          insertError,
        );
        return toNodeResult(
          createErrorOutput(
            `Failed to create backtest: ${insertError?.message}`,
          ),
        );
      }

      const backtestId = backtest.id;

      // Initialize SimBroker - SYNCHRONOUS, cached in executor
      const simBroker = this.getSimBroker(backtestId, config);
      simBroker.initializePortfolio();

      console.log(
        `[BacktestExecutor] Backtest initialized: ${backtestId} with $${config.initialCapital} (in-memory mode)`,
      );

      return toNodeResult(
        createSuccessOutput({
          backtest_id: backtestId,
          initial_capital: config.initialCapital,
          start_date:
            params.start_date || new Date().toISOString().split("T")[0],
          end_date: params.end_date || new Date().toISOString().split("T")[0],
          config: {
            fill_model: config.fillModel,
            slippage_model: config.slippageModel,
            slippage_value: config.slippageValue,
            commission_model: config.commissionModel,
            commission_value: config.commissionValue,
            allow_short: config.allowShort,
          },
          status: "running",
        }),
      );
    } catch (error) {
      console.error("[BacktestExecutor] BacktestInit failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  // ============== BACKTEST TRADE ==============
  private async executeBacktestTrade(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return toNodeResult(createErrorOutput("backtest_id is required"));
      }

      const symbol = params.symbol;
      const side = params.side;
      const quantity = parseFloat(params.quantity);
      const orderType = params.order_type || "market";

      if (!symbol || !side || !quantity) {
        return toNodeResult(
          createErrorOutput("symbol, side, and quantity are required"),
        );
      }

      // Get SimBroker instance from executor cache - SYNCHRONOUS
      const simBroker = this.getSimBroker(backtestId);

      // Parse current bar from input (passed from loop iteration)
      const currentBar = this.parseBar(params.current_bar || input);

      // If we have a current bar, process pending orders first - SYNCHRONOUS
      if (currentBar) {
        simBroker.onBar(symbol, currentBar);
      }

      // Place the new order - SYNCHRONOUS
      const orderResult = simBroker.placeOrder({
        symbol,
        side: side as "buy" | "sell",
        type: orderType as "market" | "limit" | "stop" | "stop_limit",
        quantity,
        limitPrice: params.limit_price
          ? parseFloat(params.limit_price)
          : undefined,
        stopPrice: params.stop_price
          ? parseFloat(params.stop_price)
          : undefined,
      });

      if (!orderResult.success) {
        return toNodeResult(
          createErrorOutput(orderResult.error || "Order failed"),
        );
      }

      // For immediate fill model only, attempt same-bar fill of just this order.
      // For next_bar_open, order remains pending until next bar's onBar call.
      let fill: OrderFill | null = null;
      if (currentBar && orderResult.orderId) {
        fill = simBroker.tryFillImmediateOrder(orderResult.orderId, currentBar);
      }

      // Get updated state (for pending orders that weren't filled) - SYNCHRONOUS
      const cash = simBroker.getCash();
      const positions = simBroker.getPositions();
      const pendingOrders = simBroker.getPendingOrders();
      const totalEquity = simBroker.getTotalEquity();

      if (fill) {
        return toNodeResult(
          createSuccessOutput({
            order_id: orderResult.orderId,
            order_status: "filled",
            fill_price: fill.price,
            fill_quantity: fill.quantity,
            commission: fill.commission,
            slippage: fill.slippage,
            symbol,
            side,
            quantity,
            order_type: orderType,
            cash,
            positions,
            total_equity: totalEquity,
            pending_orders: pendingOrders.length,
            pending_orders_count: pendingOrders.length,
          }),
        );
      }

      return toNodeResult(
        createSuccessOutput({
          order_id: orderResult.orderId,
          order_status: orderResult.status,
          symbol,
          side,
          quantity,
          order_type: orderType,
          cash,
          positions,
          total_equity: totalEquity,
          pending_orders: pendingOrders.length,
          pending_orders_count: pendingOrders.length,
        }),
      );
    } catch (error) {
      console.error("[BacktestExecutor] BacktestTrade failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  // ============== BACKTEST RESULTS ==============
  private async executeBacktestResults(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return toNodeResult(createErrorOutput("backtest_id is required"));
      }

      // Get SimBroker from executor cache - SYNCHRONOUS
      const simBroker = this.getSimBroker(backtestId);

      // Calculate metrics - ALL SYNCHRONOUS (no Redis!)
      const metrics = simBroker.getMetrics();
      const trades = simBroker.getTrades();
      const equityCurve = simBroker.getEquityCurve();
      const finalEquity = simBroker.getTotalEquity();

      // Persist to Supabase (only at the END of backtest)
      const supabaseClient = supabase;

      // Update backtest status
      await supabaseClient
        .from("backtests")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", backtestId);

      // Insert backtest results
      const { error: resultsError } = await supabaseClient.from("backtest_results").insert({
        backtest_id: backtestId,
        total_return: metrics.totalReturnPct,
        annualized_return: metrics.annualizedReturn,
        max_drawdown: metrics.maxDrawdownPct,
        sharpe_ratio: metrics.sharpeRatio,
        sortino_ratio: metrics.sortinoRatio,
        calmar_ratio: metrics.calmarRatio,
        total_trades: metrics.totalTrades,
        win_rate: metrics.winRate,
        profitable_trades: metrics.winningTrades,
        losing_trades: metrics.losingTrades,
        average_trade_return: metrics.avgTradePnl,
        largest_win: metrics.largestWin,
        largest_loss: metrics.largestLoss,
        final_portfolio_value: finalEquity,
        profit_factor:
          metrics.profitFactor === Infinity
            ? 999999
            : (metrics.profitFactor || 0),
        avg_win: metrics.avgWin,
        avg_loss: metrics.avgLoss,
        total_commission: metrics.totalCommission,
        total_slippage: metrics.totalSlippage,
        net_profit: metrics.totalReturn,
        expectancy:
          metrics.totalTrades > 0
            ? (metrics.winRate / 100) * metrics.avgWin -
              (1 - metrics.winRate / 100) * Math.abs(metrics.avgLoss)
            : 0,
        avg_holding_period:
          trades.length > 0
            ? trades.reduce((sum, t) => sum + (t.holdingPeriodBars || 0), 0) /
              trades.length
            : 0,
      });
      if (resultsError) {
        console.error('[BacktestExecutor] Failed to insert backtest_results:', resultsError);
      }

      // Insert trades
      if (trades.length > 0) {
        const tradeRows = trades.map((t) => ({
          backtest_id: backtestId,
          symbol: t.symbol,
          action: t.side,
          quantity: t.quantity,
          price: t.exitPrice,
          timestamp: t.exitTime,
          commission: t.commission,
          slippage: t.slippage,
          portfolio_value_before: null,
          portfolio_value_after: null,
        }));

        const { error: tradesError } = await supabaseClient.from("backtest_trades").insert(tradeRows);
        if (tradesError) {
          console.error('[BacktestExecutor] Failed to insert backtest_trades:', tradesError);
        }
      }

      // Persist equity curve to backtest_portfolio_snapshots (daily resampled)
      const dailyCurve = this.resampleToDaily(equityCurve);
      if (dailyCurve.length > 0) {
        const initialCapital = simBroker.getConfig().initialCapital;
        const snapshots = dailyCurve.map((point, idx) => {
          const prevValue =
            idx > 0 ? dailyCurve[idx - 1].totalEquity : initialCapital;
          const dailyReturn =
            prevValue > 0
              ? ((point.totalEquity - prevValue) / prevValue) * 100
              : 0;

          return {
            backtest_id: backtestId,
            date: point.timestamp.substring(0, 10),
            cash_balance: point.cash,
            stock_value: point.positionsValue,
            total_value: point.totalEquity,
            daily_return: dailyReturn,
          };
        });

        for (let i = 0; i < snapshots.length; i += 500) {
          const { error: snapshotError } = await supabaseClient
            .from("backtest_portfolio_snapshots")
            .insert(snapshots.slice(i, i + 500));
          if (snapshotError) {
            console.error('[BacktestExecutor] Failed to insert backtest_portfolio_snapshots batch:', snapshotError);
          }
        }
      }


      // Cleanup: remove SimBroker from executor cache (free memory)
      this.cleanupSimBroker(backtestId);

      console.log(
        `[BacktestExecutor] Backtest completed: ${backtestId}, Total Return: ${metrics.totalReturnPct.toFixed(
          2,
        )}%, Bars: ${metrics.totalBars} (in-memory mode)`,
      );

      return toNodeResult(
        createSuccessOutput({
          backtest_id: backtestId,
          metrics: {
            total_return: metrics.totalReturn,
            total_return_pct: metrics.totalReturnPct,
            annualized_return: metrics.annualizedReturn,
            max_drawdown: metrics.maxDrawdown,
            max_drawdown_pct: metrics.maxDrawdownPct,
            sharpe_ratio: metrics.sharpeRatio,
            sortino_ratio: metrics.sortinoRatio,
            calmar_ratio: metrics.calmarRatio,
            total_trades: metrics.totalTrades,
            winning_trades: metrics.winningTrades,
            losing_trades: metrics.losingTrades,
            win_rate: metrics.winRate,
            profit_factor: metrics.profitFactor,
            avg_win: metrics.avgWin,
            avg_loss: metrics.avgLoss,
            largest_win: metrics.largestWin,
            largest_loss: metrics.largestLoss,
            avg_trade_pnl: metrics.avgTradePnl,
            total_commission: metrics.totalCommission,
            total_slippage: metrics.totalSlippage,
            start_date: metrics.startDate,
            end_date: metrics.endDate,
            total_bars: metrics.totalBars,
          },
          trades_count: trades.length,
          equity_points: equityCurve.length,
          final_equity: finalEquity,
        }),
      );
    } catch (error) {
      console.error("[BacktestExecutor] BacktestResults failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  // ============== BACKTEST PORTFOLIO ==============
  private async executeBacktestPortfolio(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return toNodeResult(createErrorOutput("backtest_id is required"));
      }

      const simBroker = this.getSimBroker(backtestId);
      const operation = params.operation || "get_portfolio";
      const currentBar = this.parseBar(params.current_bar);
      const symbol = params.symbol;
      const prices = this.parsePrices(params.prices);

      // If pricing data is provided, mark-to-market BEFORE reading portfolio data
      if (["get_portfolio", "get_position", "update_mtm", "get_equity"].includes(operation)) {
        if (prices && Object.keys(prices).length > 0) {
          simBroker.updateAllPositionsMTM(prices);
        } else if (currentBar && symbol) {
          simBroker.onBar(symbol, currentBar);
        }
      }

      switch (operation) {
        case "get_portfolio":
          return this.portfolioGetAll(simBroker);

        case "get_position":
          return this.portfolioGetPosition(simBroker, symbol);

        case "update_mtm":
          return this.portfolioUpdateMTM(simBroker, symbol, currentBar, prices);

        case "get_cash":
          return this.portfolioGetCash(simBroker);

        case "get_equity":
          return this.portfolioGetEquity(simBroker);

        case "get_pending_orders":
          return this.portfolioGetPendingOrders(simBroker);

        case "get_trades":
          return this.portfolioGetTrades(simBroker);

        default:
          return toNodeResult(
            createErrorOutput(`Unknown portfolio operation: ${operation}`),
          );
      }
    } catch (error) {
      console.error("[BacktestExecutor] BacktestPortfolio failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  private portfolioGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions = positions.map((position) =>
      this.formatPositionWithPnlPercent(position),
    );
    const positionsValue = positions.reduce((sum, pos) => sum + pos.marketValue, 0);
    const initialCapital = simBroker.getConfig().initialCapital;
    const unrealizedPnlValue = positions.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    const realizedPnlValue = positions.reduce((sum, pos) => sum + pos.realizedPnl, 0);

    return toNodeResult(
      createSuccessOutput({
        cash: state.cash,
        initial_capital: initialCapital,
        positions: formattedPositions,
        positions_count: positions.length,
        positions_value: positionsValue,
        unrealized_pnl: this.toPercent(unrealizedPnlValue, initialCapital),
        unrealized_pnl_value: unrealizedPnlValue,
        realized_pnl: this.toPercent(realizedPnlValue, initialCapital),
        realized_pnl_value: realizedPnlValue,
        total_equity: state.cash + positionsValue,
        pending_orders: state.pendingOrders,
        pending_orders_count: state.pendingOrders.length,
        trades: state.trades,
        trades_count: state.trades.length,
      }),
    );
  }

  private portfolioGetPosition(simBroker: SimBroker, symbol?: string): NodeResult {
    if (!symbol) {
      return toNodeResult(
        createErrorOutput("'symbol' is required for get_position"),
      );
    }

    const position = simBroker.getPosition(symbol);
    const formattedPosition = position
      ? this.formatPositionWithPnlPercent(position)
      : null;
    const positionCostBasis = position
      ? Math.abs(position.avgEntryPrice * position.quantity)
      : 0;
    const unrealizedPnlValue = position?.unrealizedPnl || 0;
    const realizedPnlValue = position?.realizedPnl || 0;

    return toNodeResult(
      createSuccessOutput({
        has_position: !!position,
        position: formattedPosition,
        symbol,
        quantity: position?.quantity || 0,
        side: position?.side || null,
        avg_entry_price: position?.avgEntryPrice || 0,
        current_price: position?.currentPrice || 0,
        unrealized_pnl: this.toPercent(unrealizedPnlValue, positionCostBasis),
        unrealized_pnl_value: unrealizedPnlValue,
        realized_pnl: this.toPercent(realizedPnlValue, positionCostBasis),
        realized_pnl_value: realizedPnlValue,
        market_value: position?.marketValue || 0,
      }),
    );
  }

  private formatPositionWithPnlPercent(position: Position): Position & {
    unrealizedPnlValue: number;
    realizedPnlValue: number;
  } {
    const costBasis = Math.abs(position.avgEntryPrice * position.quantity);

    return {
      ...position,
      unrealizedPnlValue: position.unrealizedPnl,
      realizedPnlValue: position.realizedPnl,
      unrealizedPnl: this.toPercent(position.unrealizedPnl, costBasis),
      realizedPnl: this.toPercent(position.realizedPnl, costBasis),
    };
  }

  private toPercent(value: number, base: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) {
      return 0;
    }

    return (value / base) * 100;
  }

  private portfolioUpdateMTM(
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

    // MTM was already applied in the main dispatch path
    return this.portfolioGetAll(simBroker);
  }

  private portfolioGetCash(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();

    return toNodeResult(
      createSuccessOutput({
        cash: state.cash,
        buying_power: state.cash,
        initial_capital: simBroker.getConfig().initialCapital,
      }),
    );
  }

  private portfolioGetEquity(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positionsValue = Object.values(state.positions).reduce(
      (sum, pos) => sum + pos.marketValue,
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

  private portfolioGetPendingOrders(simBroker: SimBroker): NodeResult {
    const orders = simBroker.getPendingOrders();

    return toNodeResult(
      createSuccessOutput({
        pending_orders: orders,
        count: orders.length,
      }),
    );
  }

  private portfolioGetTrades(simBroker: SimBroker): NodeResult {
    const trades = simBroker.getTrades();
    const totalRealizedPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);

    return toNodeResult(
      createSuccessOutput({
        trades,
        count: trades.length,
        total_realized_pnl: totalRealizedPnl,
        winning_trades: trades.filter((trade) => trade.netPnl > 0).length,
        losing_trades: trades.filter((trade) => trade.netPnl < 0).length,
      }),
    );
  }


  private resampleToDaily(curve?: EquityPoint[]): EquityPoint[] {
    if (!curve || curve.length === 0) {
      return [];
    }

    const byDate = new Map<string, EquityPoint>();
    for (const point of curve) {
      const day = point.timestamp.substring(0, 10);
      byDate.set(day, point);
    }

    return Array.from(byDate.values());
  }

  private parsePrices(data: any): Record<string, number> | null {
    if (!data) return null;

    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }

    if (typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    const parsed = Object.entries(data).reduce<Record<string, number>>(
      (acc, [symbol, price]) => {
        const numericPrice = Number(price);
        if (Number.isFinite(numericPrice)) {
          acc[symbol] = numericPrice;
        }
        return acc;
      },
      {},
    );

    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  // ============== HELPERS ==============
  private parseBar(data: any): Bar | null {
    if (!data) return null;

    // Handle JSON string input
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return null;
      }
    }

    // Handle various input formats
    if (data.bar) {
      data = data.bar;
    }

    // Get timestamp from multiple possible field names
    const timestamp = data.timestamp || data.date || data.t;

    if (
      timestamp &&
      data.open !== undefined &&
      data.high !== undefined &&
      data.low !== undefined &&
      data.close !== undefined
    ) {
      return {
        timestamp: timestamp,
        open: parseFloat(data.open || data.o),
        high: parseFloat(data.high || data.h),
        low: parseFloat(data.low || data.l),
        close: parseFloat(data.close || data.c),
        volume: parseFloat(data.volume || data.v || 0),
      };
    }

    // Try OHLCV format
    if (data.t && data.o !== undefined) {
      return {
        timestamp: data.t,
        open: parseFloat(data.o),
        high: parseFloat(data.h),
        low: parseFloat(data.l),
        close: parseFloat(data.c),
        volume: parseFloat(data.v || 0),
      };
    }

    return null;
  }
}
