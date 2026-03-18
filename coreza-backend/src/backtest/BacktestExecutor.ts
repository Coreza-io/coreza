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

import {
  INodeExecutor,
  NodeInput,
  NodeResult,
  WorkflowEdge,
  WorkflowNode,
} from "../nodes/types";
import {
  SimBroker,
  SimBrokerConfig,
  Bar,
  Position,
  EquityPoint,
} from "./simBroker";
import { OrderEvent, normalizeOrderType } from "../types/order";
import { BrokerExecutor } from "../nodes/executors/BrokerExecutor";
import { supabase } from "../config/supabase";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  leanSuccess,
  leanError,
} from "../utils/normalizeOutput";
import { discoverIndicators } from "../nodes/executors/InitializeIndicatorsExecutor";
import {
  buildIndicatorKey,
  IndicatorStateManager,
} from "../engine";
import { parseBar, parsePrices, toPercent } from "../utils/barParser";
import { formatPositionWithPnlPercent } from "../utils/portfolioHelpers";

import { BacktestSessionManager } from "./session";

interface DiscoveredIndicator {
  nodeId: string;
  type: string;
  params: Record<string, any>;
}

function extractStrategySubgraph(
  backtestNodeId: string,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; entryNodeIds: string[] } {
  // Identify entry nodes: nodes directly downstream of BacktestInit
  const entryNodeIds = allEdges
    .filter((edge) => edge.source === backtestNodeId)
    .map((edge) => edge.target);

  const visited = new Set<string>();
  const queue = [...entryNodeIds];
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;

    visited.add(nodeId);
    const node = allNodes.find((n) => n.id === nodeId);
    if (node) nodes.push(node);

    // Only include edges BETWEEN strategy nodes (not from BacktestInit)
    const outgoing = allEdges.filter((edge) => edge.source === nodeId);
    edges.push(...outgoing);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
  }

  // Deduplicate entry node IDs
  const uniqueEntryNodeIds = [...new Set(entryNodeIds)].filter((id) =>
    visited.has(id),
  );

  return { nodes, edges, entryNodeIds: uniqueEntryNodeIds };
}

// Key prefix for caching SimBroker instances by backtest id
const SIM_BROKER_KEY_PREFIX = "simBroker:";

export class BacktestExecutor implements INodeExecutor {
  readonly category = "Backtest";
  readonly syncCapable = true;
  private static simBrokerCache = new Map<string, SimBroker>();
  private static backtestStartTimes = new Map<string, number>();
  private cachedRunId: string | null = null;

  /**
   * Expose the SimBroker cache so PortfolioExecutor can access it
   * for backtest-mode portfolio queries.
   */
  static getSimBrokerCache(): Map<string, SimBroker> {
    return BacktestExecutor.simBrokerCache;
  }

  public static cleanupBacktestResources(backtestId: string): void {
    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    BacktestExecutor.simBrokerCache.delete(key);
    BacktestExecutor.backtestStartTimes.delete(backtestId);
  }

  public static resetBacktestState(backtestId: string): void {
    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    const existing = BacktestExecutor.simBrokerCache.get(key);
    if (!existing) {
      return;
    }

    const config = existing.getConfig();
    const freshSimBroker = new SimBroker(backtestId, config);
    BacktestExecutor.simBrokerCache.set(key, freshSimBroker);
    BacktestExecutor.backtestStartTimes.delete(backtestId);
  }

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    this.clearResultCachesForRun(context?.runId);

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
        // Backward compat: delegate to the same internal method
        return this.executeBacktestPortfolio(node, input, context);
      case "Portfolio":
        // Unified Portfolio node in backtest mode also routes here
        return this.executeBacktestPortfolio(node, input, context);
      case "OnBar":
        return this.executeOnBar(node, input, context);
      default:
        return toNodeResult(
          createErrorOutput(`Unknown backtest node type: ${nodeName}`),
        );
    }
  }


  private clearResultCachesForRun(runId?: string): void {
    if (runId && runId !== this.cachedRunId) {
      this._onBarResults.clear();
      this._tradeResults.clear();
      this.cachedRunId = runId;
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
    const existing = BacktestExecutor.simBrokerCache.get(key);
    if (existing) {
      return existing;
    }

    const simBroker = new SimBroker(backtestId, config);
    BacktestExecutor.simBrokerCache.set(key, simBroker);

    return simBroker;
  }

  /** Remove SimBroker instance from cache after backtest completion. */
  private cleanupSimBroker(backtestId: string): void {
    BacktestExecutor.cleanupBacktestResources(backtestId);
  }

  private formatDuration(durationMs: number): string {
    const totalCentiseconds = Math.max(0, Math.floor(durationMs / 10));
    const hours = Math.floor(totalCentiseconds / 360000);
    const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;

    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${centiseconds
      .toString()
      .padStart(2, "0")}`;
  }

  public async finalizeAll(_store?: any): Promise<void> {
    const entries = Array.from(BacktestExecutor.simBrokerCache.entries());

    for (const [key, simBroker] of entries) {
      const backtestId = key.replace(SIM_BROKER_KEY_PREFIX, "");
      try {
        await this.portfolioFinalize(simBroker, backtestId);
      } catch (error) {
        console.error(
          `[BacktestExecutor] Auto-finalize failed for ${backtestId}:`,
          error,
        );
      }
    }
  }

  // ============== BACKTEST INIT ==============
  public async executeBacktestInit(
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
      const runId = context?.runId || workflowId;

      if (!userId || !workflowId) {
        return toNodeResult(
          createErrorOutput("User ID and Workflow ID required for backtest"),
        );
      }

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
        return toNodeResult(
          createErrorOutput(
            `Failed to create backtest: ${insertError?.message}`,
          ),
        );
      }

      const backtestId = backtest.id;
      BacktestExecutor.backtestStartTimes.set(backtestId, Date.now());
      const simBroker = this.getSimBroker(backtestId, config);
      simBroker.initializePortfolio();

      const broker = String(params.broker || "").toLowerCase();
      const credentialId = params.credential_id;
      const symbol = params.symbol;
      const interval = params.interval;
      const startDate = params.start_date;
      const endDate = params.end_date;
      const assetType = params.asset_type;
      const feed = params.feed;

      if (!broker || !symbol || !interval) {
        return toNodeResult(
          createErrorOutput("broker, symbol, and interval are required"),
        );
      }

      if (broker !== "yahoo_finance" && !credentialId) {
        return toNodeResult(
          createErrorOutput("credential_id is required for selected broker"),
        );
      }

      const brokerExecutor = new BrokerExecutor();
      const brokerInput: NodeInput = {
        operation: "get_candle",
        symbol,
        interval,
        start: startDate,
        end: endDate,
        asset_type: assetType,
        feed,
        credential_id: credentialId,
        limit: "50000",
      };

      const brokerNode: WorkflowNode = {
        id: `broker:${broker}:get_candle`,
        name: broker,
        node_type: "main",
        category: "Broker",
        subCategory: broker,
        values: brokerInput,
      };

      const brokerResult = await brokerExecutor.execute(
        brokerNode,
        brokerInput,
        {
          userId: context?.userId,
          workflowId: context?.workflowId || "backtest-init",
          runId: context?.runId || `backtest-${Date.now()}`,
        },
      );

      if (!brokerResult.success) {
        return toNodeResult(
          createErrorOutput(
            `Failed to fetch historical data: ${brokerResult.error}`,
          ),
        );
      }

      const barSeries = brokerResult.data?.BarSeries;
      const bars = barSeries?.[0]?.bars || [];

      if (!Array.isArray(bars) || bars.length === 0) {
        return toNodeResult(
          createErrorOutput("No historical bars returned for backtest"),
        );
      }

      const warmupPeriodRaw = parseInt(params.warmup_period, 10) || 200;
      const warmupPeriod = Math.min(Math.max(warmupPeriodRaw, 0), bars.length);
      //const autoDetect = String(params.auto_detect ?? "true") === "true";

      const allNodes: WorkflowNode[] = context?.nodes || [];
      const allEdges: WorkflowEdge[] = context?.edges || [];

      let discoveredIndicators: DiscoveredIndicator[] = [];
      if (allNodes.length > 0) {
        discoveredIndicators = discoverIndicators(
          node.id,
          allNodes,
          allEdges,
        ) as DiscoveredIndicator[];
      }

      const warmupBars = bars.slice(0, warmupPeriod);
      const remainingBars = bars.slice(warmupPeriod);

      const stateManager = new IndicatorStateManager();
      if (
        stateManager &&
        discoveredIndicators.length > 0 &&
        warmupBars.length > 0
      ) {
        for (const ind of discoveredIndicators) {
          const { candle_data, ...restParams } = ind.params;
          const indParams = {
            ...restParams,
            symbol,
            timeframe: interval,
          };
          const key = buildIndicatorKey(
            userId,
            workflowId,
            runId,
            symbol,
            interval,
            ind.nodeId,
          );

          await stateManager.warmUp(
            key,
            ind.type,
            indParams,
            warmupBars,
            false,
          );
        }
      }

      const {
        nodes: strategyNodes,
        edges: strategyEdges,
        entryNodeIds,
      } = extractStrategySubgraph(node.id, allNodes, allEdges);

      // Build bar events array for in-memory processing (no Redis Stream)
      const barEvents = remainingBars.map((bar: any, i: number) => ({
        bar,
        symbol,
        interval,
        barIndex: i,
      }));

      // Build the BacktestInit result that downstream nodes need via templates
      const backtestInitData = {
        backtest_id: backtestId,
        symbol,
        interval,
        initial_capital: config.initialCapital,
        start_date: startDate,
        end_date: endDate,
        fill_model: config.fillModel,
        slippage_model: config.slippageModel,
        slippage_value: config.slippageValue,
        commission_model: config.commissionModel,
        commission_value: config.commissionValue,
      };

      const backtestInitResult: Record<string, any> = {
        [node.id]: { success: true, data: backtestInitData },
        BacktestInit: { success: true, data: backtestInitData },
      };

      const isManual = !context?.runId;
      const effectiveRunId = context?.runId || `manual-${backtestId}`;

      const session = BacktestSessionManager.getInstance().createSession(
        backtestId,
        workflowId,
        node.id,
        userId,
        strategyNodes,
        strategyEdges,
        entryNodeIds,
        backtestInitResult,
        barEvents,
        effectiveRunId,
        stateManager,
      );

      if (
        !isManual &&
        remainingBars.length > 0 &&
        strategyNodes.length > 0 &&
        entryNodeIds.length > 0
      ) {
        session
          .runAll()
          .catch((err) =>
            console.error("[BacktestSession] runAll failed:", err),
          )
          .finally(() =>
            BacktestSessionManager.getInstance().deleteSession(backtestId),
          );
      }

      if (
        remainingBars.length === 0 ||
        strategyNodes.length === 0 ||
        entryNodeIds.length === 0
      ) {
        await this.portfolioFinalize(simBroker, backtestId);
        BacktestSessionManager.getInstance().deleteSession(backtestId);
      }

      return toNodeResult(
        createSuccessOutput({
          backtest_id: backtestId,
          mode: isManual ? "manual" : "batch",
          total_bars: remainingBars.length,
          initial_capital: config.initialCapital,
          start_date: params.start_date,
          end_date: params.end_date,
          symbol,
          interval,
          config: {
            fill_model: config.fillModel,
            slippage_model: config.slippageModel,
            slippage_value: config.slippageValue,
            commission_model: config.commissionModel,
            commission_value: config.commissionValue,
          },
          data: {
            bars_fetched: bars.length,
            warmup_bars_used: warmupBars.length,
            bars_emitted: remainingBars.length,
            indicators_initialized: discoveredIndicators.length,
          },
          status: !isManual && remainingBars.length > 0 ? "running" : "ready",
        }),
      );
    } catch (error) {
      console.error("[BacktestExecutor] BacktestInit failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  // ============== ON BAR ==============
  // Pre-allocated reusable result template per node for backtest hot path
  private _onBarResults = new Map<string, NodeResult>();

  private executeOnBar(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    void node;

    const data = input?.data;
    if (!this._onBarResults.has(node.id)) {
      this._onBarResults.set(node.id, {
        success: true,
        data: {
          BarSeries: [{ symbol: "", interval: "", bars: [null as any] }],
          barIndex: 0,
        },
      });
    }

    // Mutate per-node pre-allocated template instead of creating new objects
    const onBarResult = this._onBarResults.get(node.id)!;
    const barSeries = onBarResult.data.BarSeries[0];
    barSeries.symbol = data?.symbol;
    barSeries.interval = data?.interval;
    barSeries.bars[0] = data?.bar;
    onBarResult.data.barIndex = data?.barIndex;

    return onBarResult;
  }

  // ============== BACKTEST TRADE ==============
  // Pre-allocated reusable result template per node for backtest trade hot path
  private _tradeResults = new Map<string, NodeResult>();

  private executeBacktestTrade(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return leanError("backtest_id is required");
      }

      const symbol = params.symbol;
      const side = params.side;
      const quantity = parseFloat(params.quantity);
      const orderType = params.order_type || "market";

      if (!symbol || !side || !quantity) {
        return leanError("symbol, side, and quantity are required");
      }

      // Get SimBroker instance from executor cache - SYNCHRONOUS
      const simBroker = this.getSimBroker(backtestId);

      const currentBar = parseBar(params.current_bar);

      // Parse current bar from input (passed from loop iteration)
      // let currentBar;

      // try {
      //   currentBar =
      //     typeof params.current_bar === "string"
      //       ? JSON.parse(params.current_bar)
      //       : params.current_bar;
      // } catch {
      //   throw new Error("Invalid current_bar JSON");
      // }

      // If we have a current bar, process pending orders first - SYNCHRONOUS
      if (currentBar) {
        simBroker.onBar(symbol, currentBar);
      }

      // Place the new order - SYNCHRONOUS
      const orderResult = simBroker.placeOrder({
        symbol,
        side: side as "buy" | "sell",
        orderType: normalizeOrderType(orderType),
        quantity,
        limitPrice: params.limit_price
          ? parseFloat(params.limit_price)
          : undefined,
        stopPrice: params.stop_price
          ? parseFloat(params.stop_price)
          : undefined,
      });

      if (!orderResult.success) {
        return leanError(orderResult.error || "Order failed");
      }

      // For immediate fill model only, attempt same-bar fill of just this order.
      // For next_bar_open, order remains pending until next bar's onBar call.
      let fill: OrderEvent | null = null;
      if (currentBar && orderResult.orderId) {
        fill = simBroker.tryFillImmediateOrder(orderResult.orderId, currentBar);
      }

      // Get updated state (for pending orders that weren't filled) - SYNCHRONOUS
      const cash = simBroker.getCash();
      const positions = simBroker.getPositions();
      const pendingOrders = simBroker.getPendingOrders();
      const totalEquity = simBroker.getTotalEquity();

      if (!this._tradeResults.has(node.id)) {
        this._tradeResults.set(node.id, {
          success: true,
          data: {
            order_id: "",
            order_status: "",
            fill_price: undefined,
            fill_quantity: undefined,
            commission: 0,
            slippage: 0,
            symbol: "",
            side: "",
            quantity: 0,
            order_type: "",
            cash: 0,
            positions: [] as Position[],
            total_equity: 0,
            pending_orders: 0,
            pending_orders_count: 0,
          },
        });
      }

      const tradeResult = this._tradeResults.get(node.id)!;
      tradeResult.data.order_id = orderResult.orderId;
      tradeResult.data.order_status = fill ? "filled" : orderResult.status;
      tradeResult.data.fill_price = fill?.fillPrice;
      tradeResult.data.fill_quantity = fill?.fillQuantity;
      tradeResult.data.commission = fill?.orderFee?.value ?? 0;
      tradeResult.data.slippage = fill?.slippage ?? 0;
      tradeResult.data.symbol = symbol;
      tradeResult.data.side = side;
      tradeResult.data.quantity = quantity;
      tradeResult.data.order_type = orderType;
      tradeResult.data.cash = cash;
      tradeResult.data.positions = positions.map((position) => ({
        ...position,
      }));
      tradeResult.data.total_equity = totalEquity;
      tradeResult.data.pending_orders = pendingOrders.length;
      tradeResult.data.pending_orders_count = pendingOrders.length;

      return tradeResult;
    } catch (error) {
      console.error("[BacktestExecutor] BacktestTrade failed:", error);
      return leanError(error instanceof Error ? error.message : String(error));
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

      const metrics = simBroker.getMetrics();
      const trades = simBroker.getTrades();
      const equityCurve = simBroker.getEquityCurve();
      const finalEquity = simBroker.getTotalEquity();

      await this.portfolioFinalize(simBroker, backtestId);

      return leanSuccess({
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
      });
    } catch (error) {
      console.error("[BacktestExecutor] BacktestResults failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  private async portfolioFinalize(
    simBroker: SimBroker,
    backtestId: string,
  ): Promise<void> {
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
    const { error: resultsError } = await supabaseClient
      .from("backtest_results")
      .insert({
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
        profit_factor: Number.isFinite(metrics.profitFactor)
          ? metrics.profitFactor
          : null,
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
      console.error(
        "[BacktestExecutor] Failed to insert backtest_results:",
        resultsError,
      );
    }

    // Insert trades
    if (trades.length > 0) {
      const tradeRows = trades.map((t) => ({
        backtest_id: backtestId,
        symbol: t.symbol,
        action: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        entryTime: t.entryTime,
        exitPrice: t.exitPrice,
        exitTime: t.exitTime,
        commission: t.commission,
        net_pnl: t.netPnl,
        slippage: t.slippage,
        portfolio_value_before: null,
        portfolio_value_after: null,
      }));

      const { error: tradesError } = await supabaseClient
        .from("backtest_trades")
        .insert(tradeRows);
      if (tradesError) {
        console.error(
          "[BacktestExecutor] Failed to insert backtest_trades:",
          tradesError,
        );
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
          console.error(
            "[BacktestExecutor] Failed to insert backtest_portfolio_snapshots batch:",
            snapshotError,
          );
        }
      }
    }

    const startedAtMs = BacktestExecutor.backtestStartTimes.get(backtestId);
    const elapsedTime =
      typeof startedAtMs === "number"
        ? this.formatDuration(Date.now() - startedAtMs)
        : "00:00:00:00";

    // Cleanup: remove SimBroker from executor cache (free memory)
    this.cleanupSimBroker(backtestId);

    console.log(
      `[BacktestExecutor] Backtest completed: ${backtestId}, Total Return: ${metrics.totalReturnPct.toFixed(
        2,
      )}%, Bars: ${metrics.totalBars} (in-memory mode), Time: ${elapsedTime}`,
    );
  }

  async finalizeBacktestById(backtestId: string): Promise<void> {
    const simBroker = this.getSimBroker(backtestId);
    await this.portfolioFinalize(simBroker, backtestId);
  }
  // ============== BACKTEST PORTFOLIO ==============
  private executeBacktestPortfolio(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const backtestId = params.backtest_id;
      if (!backtestId) {
        return leanError("backtest_id is required");
      }

      const simBroker = this.getSimBroker(backtestId);
      const operation = params.operation || "get_portfolio";
      const currentBar = parseBar(params.current_bar);
      const symbol = params.symbol;
      const prices = parsePrices(params.prices);

      // If pricing data is provided, mark-to-market BEFORE reading portfolio data
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
          return leanError(`Unknown portfolio operation: ${operation}`);
      }
    } catch (error) {
      console.error("[BacktestExecutor] BacktestPortfolio failed:", error);
      return leanError(error instanceof Error ? error.message : String(error));
    }
  }

  private portfolioGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions = positions.map((position) =>
      formatPositionWithPnlPercent(position),
    );
    const positionsValue = positions.reduce(
      (sum, pos) => sum + pos.marketValue,
      0,
    );
    const initialCapital = simBroker.getConfig().initialCapital;
    const unrealizedPnlValue = positions.reduce(
      (sum, pos) => sum + pos.unrealizedPnl,
      0,
    );
    const realizedPnlValue = positions.reduce(
      (sum, pos) => sum + pos.realizedPnl,
      0,
    );
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

  private portfolioGetPosition(
    simBroker: SimBroker,
    symbol?: string,
  ): NodeResult {
    if (!symbol) {
      return leanError("'symbol' is required for get_position");
    }

    const position = simBroker.getPosition(symbol);
    const formattedPosition = position
      ? formatPositionWithPnlPercent(position)
      : null;
    const positionCostBasis = position
      ? Math.abs(position.avgEntryPrice * position.quantity)
      : 0;
    const unrealizedPnlValue = position?.unrealizedPnl || 0;
    const realizedPnlValue = position?.realizedPnl || 0;

    return leanSuccess({
      has_position: !!position,
      position: formattedPosition,
      symbol,
      quantity: position?.quantity || 0,
      side: position?.side || null,
      avg_entry_price: position?.avgEntryPrice || 0,
      current_price: position?.currentPrice || 0,
      unrealized_pnl_pct: toPercent(unrealizedPnlValue, positionCostBasis),
      unrealized_pnl: unrealizedPnlValue,
      realized_pnl_pct: toPercent(realizedPnlValue, positionCostBasis),
      realized_pnl: realizedPnlValue,
      market_value: position?.marketValue || 0,
    });
  }

  private portfolioUpdateMTM(
    simBroker: SimBroker,
    symbol?: string,
    bar?: Bar | null,
    prices?: Record<string, number> | null,
  ): NodeResult {
    if (!(prices && Object.keys(prices).length > 0) && !(symbol && bar)) {
      return leanError(
        "Provide either 'prices' map or both 'symbol' and 'current_bar' for update_mtm",
      );
    }

    // MTM was already applied in the main dispatch path
    return this.portfolioGetAll(simBroker);
  }

  private portfolioGetCash(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();

    return leanSuccess({
      cash: state.cash,
      buying_power: state.cash,
      initial_capital: simBroker.getConfig().initialCapital,
    });
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
    const initialCapital = simBroker.getConfig().initialCapital;

    return leanSuccess({
      total_equity: totalEquity,
      cash: state.cash,
      positions_value: positionsValue,
      initial_capital: initialCapital,
      return_pct: ((totalEquity - initialCapital) / initialCapital) * 100,
      peak_equity: peak,
      drawdown_pct: drawdownPct,
    });
  }

  private portfolioGetPendingOrders(simBroker: SimBroker): NodeResult {
    const orders = simBroker.getPendingOrders();

    return leanSuccess({
      pending_orders: orders,
      count: orders.length,
    });
  }

  private portfolioGetTrades(simBroker: SimBroker): NodeResult {
    const trades = simBroker.getTrades();
    const totalRealizedPnl = trades.reduce(
      (sum, trade) => sum + trade.netPnl,
      0,
    );

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: totalRealizedPnl,
      winning_trades: trades.filter((trade) => trade.netPnl > 0).length,
      losing_trades: trades.filter((trade) => trade.netPnl < 0).length,
    });
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
}
