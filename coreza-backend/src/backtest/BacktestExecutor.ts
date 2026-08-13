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
import { supabase } from "../config/supabase";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  leanSuccess,
  leanError,
} from "../utils/normalizeOutput";
import { discoverWarmupNodes } from "../nodes/executors/InitializeIndicatorsExecutor";
import type { DiscoveredWarmupNode } from "../nodes/executors/InitializeIndicatorsExecutor";
import { buildIndicatorKey, IndicatorStateManager } from "../engine";
import { parseBar, parsePrices, toPercent } from "../utils/barParser";
import { formatPositionWithPnlPercent } from "../utils/portfolioHelpers";

import { BacktestSessionManager, MultiBarEvent } from "./session";
import { toMarketBarEnvelope } from "./simBroker/marketEnvelope";
import {
  resolveRollingWindowSeedSize,
  seedRollingWindows,
} from "./rollingWindowSeed";
import type { RollingWindowSeed } from "./rollingWindowSeed";
import {
  HistoricalDataService,
  historicalBarTimestamp,
} from "../marketData/HistoricalDataService";
import type { HistoricalBar } from "../marketData/HistoricalDataService";
import { parseWarmupPeriod } from "../utils/warmupPeriod";

type AlignedMultiBarEvent = MultiBarEvent & {
  /** Symbols whose bars were copied from their latest real observation. */
  fillForwardSymbols?: string[];
};

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

  static getSimBrokerForBacktest(backtestId: string): SimBroker | undefined {
    return BacktestExecutor.simBrokerCache.get(
      `${SIM_BROKER_KEY_PREFIX}${backtestId}`,
    );
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
      const { data: workflow, error: workflowLookupError } =
        await supabaseClient
          .from("workflows")
          .select("id")
          .eq("id", workflowId)
          .eq("user_id", userId)
          .maybeSingle();

      if (workflowLookupError) {
        return toNodeResult(
          createErrorOutput(
            `Failed to validate workflow before backtest: ${workflowLookupError.message}`,
          ),
        );
      }

      if (!workflow) {
        return toNodeResult(
          createErrorOutput(
            "Workflow not found. Please save the workflow before running a backtest.",
          ),
        );
      }

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
        } as any)
        .select("id")
        .single();

      if (insertError || !backtest) {
        return toNodeResult(
          createErrorOutput(
            `Failed to create backtest: ${insertError?.message}`,
          ),
        );
      }

      const backtestId = (backtest as { id: string }).id;
      const effectiveRunId = context?.runId || `manual-${backtestId}`;
      BacktestExecutor.backtestStartTimes.set(backtestId, Date.now());
      const simBroker = this.getSimBroker(backtestId, config);
      simBroker.initializePortfolio();

      const broker = String(params.broker || "").toLowerCase();
      const credentialId = params.credential_id;
      const symbol = params.symbol;
      const symbols = this.parseSymbols(params.symbols, params.symbol);
      const interval = params.interval;
      const startDate = params.start_date || new Date().toISOString().split("T")[0];
      const endDate = params.end_date || new Date().toISOString().split("T")[0];
      const assetType = params.asset_type;
      const feed = params.feed;

      if (!broker || symbols.length === 0 || !interval) {
        return toNodeResult(
          createErrorOutput(
            "broker, symbol/symbols, and interval are required",
          ),
        );
      }

      if (broker !== "yahoo_finance" && !credentialId) {
        return toNodeResult(
          createErrorOutput("credential_id is required for selected broker"),
        );
      }

      const warmupBarsRequested = parseWarmupPeriod(params.warmup_period);
      const historicalDataService = new HistoricalDataService();
      const strategyEntries = await Promise.all(
        symbols.map(async (currentSymbol) => [
          currentSymbol,
          await historicalDataService.fetchRange(
            { provider: broker, symbol: currentSymbol, interval, start: startDate, end: endDate, assetType, feed, credentialId },
            context,
          ),
        ] as const),
      );
      const historicalDataBySymbol = new Map(strategyEntries);

      if (historicalDataBySymbol.size === 0) {
        return toNodeResult(
          createErrorOutput("No historical bars returned for backtest"),
        );
      }

      const primarySymbol = symbols[0];
      const primaryBars = historicalDataBySymbol.get(primarySymbol) || [];
      if (!Array.isArray(primaryBars) || primaryBars.length === 0) {
        return toNodeResult(
          createErrorOutput(`No historical bars returned for ${primarySymbol}`),
        );
      }
      for (const secondarySymbol of symbols.slice(1)) {
        if ((historicalDataBySymbol.get(secondarySymbol)?.length ?? 0) === 0) {
          console.warn(`[BacktestExecutor] No strategy bars returned for secondary symbol ${secondarySymbol}`);
        }
      }

      //const autoDetect = String(params.auto_detect ?? "true") === "true";

      const allNodes: WorkflowNode[] = context?.nodes || [];
      const allEdges: WorkflowEdge[] = context?.edges || [];

      let warmupNodes: DiscoveredWarmupNode[] = [];
      if (allNodes.length > 0) {
        warmupNodes = discoverWarmupNodes(
          node.id,
          allNodes,
          allEdges,
        );
      }
      const discoveredIndicators = warmupNodes.filter(
        (candidate) => candidate.type !== "rollingwindow",
      );
      const discoveredWindows = warmupNodes.filter(
        (candidate) =>
          candidate.type === "rollingwindow" &&
          String(candidate.params?.operation ?? "set").toLowerCase() === "set",
      );
      let rollingWindowSize: number | undefined;
      try {
        rollingWindowSize = resolveRollingWindowSeedSize(discoveredWindows);
      } catch (error) {
        return toNodeResult(
          createErrorOutput(
            error instanceof Error ? error.message : String(error),
          ),
        );
      }

      const warmupEntries = await Promise.all(
        symbols.map(async (currentSymbol) => [
          currentSymbol,
          await historicalDataService.fetchPreviousBars(
            { provider: broker, symbol: currentSymbol, interval, count: warmupBarsRequested, endExclusive: startDate, assetType, feed, credentialId },
            context,
          ),
        ] as const),
      );
      const warmupBarsBySymbol = new Map<string, HistoricalBar[]>(warmupEntries);
      const warnings = symbols.flatMap((currentSymbol) => {
        const available = warmupBarsBySymbol.get(currentSymbol)?.length ?? 0;
        return available < warmupBarsRequested
          ? [{ code: "INSUFFICIENT_WARMUP_HISTORY" as const, symbol: currentSymbol, requested: warmupBarsRequested, available, affectedNodes: warmupNodes.map((candidate) => candidate.nodeId) }]
          : [];
      });

      const stateManager = new IndicatorStateManager();
      if (discoveredIndicators.length > 0) {
        for (const currentSymbol of symbols) {
          const symbolWarmupBars = warmupBarsBySymbol.get(currentSymbol) || [];
          for (const ind of discoveredIndicators) {
            const { candle_data, ...restParams } = ind.params;
            const indParams = {
              ...restParams,
              symbol: currentSymbol,
              timeframe: interval,
            };
            const key = buildIndicatorKey(
              userId,
              workflowId,
              effectiveRunId,
              currentSymbol,
              interval,
              ind.nodeId,
            );

            await stateManager.warmUp(
              key,
              ind.type,
              indParams,
              symbolWarmupBars,
              false,
            );
          }
        }
      }

      const rollingWindowSeed: RollingWindowSeed | undefined =
        rollingWindowSize === undefined
          ? undefined
          : { size: rollingWindowSize, interval, symbols, warmupBarsBySymbol };
      const rollingWindowsInitialized = rollingWindowSeed
        ? seedRollingWindows({
            ...rollingWindowSeed,
            userId,
            workflowId,
            executionId: effectiveRunId,
          })
        : 0;

      const {
        nodes: strategyNodes,
        edges: strategyEdges,
        entryNodeIds,
      } = extractStrategySubgraph(node.id, allNodes, allEdges);

      // Build bar events array for in-memory processing (no Redis Stream)
      const barEvents = this.alignMultiSymbolBars(
        symbols,
        interval,
        historicalDataBySymbol,
      );

      // Build the BacktestInit result that downstream nodes need via templates
      const backtestInitData = {
        backtest_id: backtestId,
        symbol: primarySymbol,
        symbols,
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
        rollingWindowSeed,
        { interval, symbols, warmupBarsBySymbol, indicators: discoveredIndicators },
      );

      if (
        !isManual &&
        barEvents.length > 0 &&
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

      // if (
      //   barEvents.length === 0 ||
      //   strategyNodes.length === 0 ||
      //   entryNodeIds.length === 0
      // ) {
      //   await this.portfolioFinalize(simBroker, backtestId);
      //   BacktestSessionManager.getInstance().deleteSession(backtestId);
      // }

      return toNodeResult(
        createSuccessOutput({
          backtest_id: backtestId,
          mode: isManual ? "manual" : "batch",
          total_bars: barEvents.length,
          initial_capital: config.initialCapital,
          start_date: params.start_date,
          end_date: params.end_date,
          symbol: primarySymbol,
          symbols,
          interval,
          config: {
            fill_model: config.fillModel,
            slippage_model: config.slippageModel,
            slippage_value: config.slippageValue,
            commission_model: config.commissionModel,
            commission_value: config.commissionValue,
          },
          data: {
            bars_fetched: Array.from(historicalDataBySymbol.values()).reduce(
              (sum, bars) => sum + bars.length,
              0,
            ),
            warmup_source: "pre_start",
            warmup_bars_requested: warmupBarsRequested,
            warmup_bars_used:
              warmupBarsBySymbol.get(primarySymbol)?.length ?? 0,
            warmup_bars_by_symbol: Object.fromEntries(
              symbols.map((currentSymbol) => [currentSymbol, warmupBarsBySymbol.get(currentSymbol)?.length ?? 0]),
            ),
            first_warmup_timestamp: this.extremeTimestamp(warmupBarsBySymbol, "first"),
            last_warmup_timestamp: this.extremeTimestamp(warmupBarsBySymbol, "last"),
            first_strategy_timestamp: barEvents[0]?.timestamp ?? null,
            bars_emitted: barEvents.length,
            indicators_initialized: discoveredIndicators.length,
            indicators_ready: await this.countReadyIndicators(stateManager, userId, workflowId, effectiveRunId, symbols, interval, discoveredIndicators),
            rolling_windows_initialized: rollingWindowsInitialized,
            warnings,
            ...(rollingWindowsInitialized > 0
              ? { rolling_window_size: rollingWindowSize }
              : {}),
          },
          status: !isManual && barEvents.length > 0 ? "running" : "ready",
        }),
      );
    } catch (error) {
      console.error("[BacktestExecutor] BacktestInit failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  private parseSymbols(symbolsRaw: unknown, fallbackSymbol: unknown): string[] {
    const preferred = String(symbolsRaw || "").trim();
    const base = preferred || String(fallbackSymbol || "").trim();
    return [
      ...new Set(
        base
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean),
      ),
    ];
  }

  private extremeTimestamp(
    barsBySymbol: Map<string, HistoricalBar[]>,
    position: "first" | "last",
  ): number | null {
    const timestamps = [...barsBySymbol.values()].flatMap((bars) =>
      bars.map(historicalBarTimestamp),
    );
    if (timestamps.length === 0) return null;
    return position === "first" ? Math.min(...timestamps) : Math.max(...timestamps);
  }

  private async countReadyIndicators(
    manager: IndicatorStateManager,
    userId: string,
    workflowId: string,
    executionId: string,
    symbols: string[],
    interval: string,
    indicators: DiscoveredWarmupNode[],
  ): Promise<number> {
    const readiness = await Promise.all(symbols.flatMap((currentSymbol) => indicators.map(async (indicator) => {
      const key = buildIndicatorKey(userId, workflowId, executionId, currentSymbol, interval, indicator.nodeId);
      return (await manager.getState(key))?.isReady === true;
    })));
    return readiness.filter(Boolean).length;
  }

  private alignMultiSymbolBars(
    symbols: string[],
    interval: string,
    barsBySymbol: Map<string, any[]>,
  ): AlignedMultiBarEvent[] {
    const timestamps = new Set<number>();

    for (const bars of barsBySymbol.values()) {
      for (const bar of bars) {
        timestamps.add(bar.time as number);
      }
    }

    const orderedTimestamps = [...timestamps].sort((a, b) => a - b);
    const indexes = new Map<string, number>();
    const previousBars = new Map<string, any>();

    const events: AlignedMultiBarEvent[] = [];

    for (const symbol of symbols) {
      indexes.set(symbol, 0);
    }

    for (const [barIndex, timestamp] of orderedTimestamps.entries()) {
      const alignedBars: Record<string, any> = {};
      const activeSymbols: string[] = [];
      const fillForwardSymbols: string[] = [];

      for (const symbol of symbols) {
        const symbolBars = barsBySymbol.get(symbol) || [];
        const currentIndex = indexes.get(symbol) || 0;
        const currentBar = symbolBars[currentIndex];

        if (currentBar && (currentBar.time as number) === timestamp) {
          const realBar = {
            ...currentBar,
            _sourceTimestamp: currentBar.time as number,
            _isFillForward: false,
          };
          alignedBars[symbol] = realBar;
          previousBars.set(symbol, realBar);
          indexes.set(symbol, currentIndex + 1);
          activeSymbols.push(symbol);
          continue;
        }

        const previousBar = previousBars.get(symbol);

        if (previousBar) {
          // Fill-forward: keep the ORIGINAL observation timestamp so age is
          // measured against the last real bar, not the aligned clock.
          alignedBars[symbol] = {
            ...previousBar,
            time: timestamp,
            _sourceTimestamp:
              previousBar._sourceTimestamp ?? (previousBar.time as number),
            _isFillForward: true,
          };
          activeSymbols.push(symbol);
          fillForwardSymbols.push(symbol);
        }
      }

      if (activeSymbols.length > 0) {
        events.push({
          timestamp: new Date(timestamp).toISOString(),
          barIndex,
          interval,
          symbols: activeSymbols,
          bars: alignedBars,
          fillForwardSymbols,
        });
      }
    }

    return events;
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
      const operation = params.operation || "place_order";

      if (!symbol) {
        return leanError("symbol is required");
      }

      // Get SimBroker instance from executor cache - SYNCHRONOUS
      const simBroker = this.getSimBroker(backtestId);

      // LEAN-style liquidation: SimBroker computes the signed target itself.
      if (operation === "liquidate") {
        const result = simBroker.liquidate(symbol);
        if (!result.success) {
          return leanError(result.error || "Liquidation failed");
        }
        return toNodeResult(
          createSuccessOutput({
            operation: "liquidate",
            symbol,
            skipped: result.skipped === true,
            reason: "reason" in result ? result.reason : undefined,
            canceled_order_ids: result.canceledOrderIds,
            order_id: "orderId" in result ? result.orderId : undefined,
            order_status:
              "fill" in result && result.fill
                ? result.fill.status
                : "status" in result
                  ? result.status
                  : undefined,
            fill_price: "fill" in result ? result.fill?.fillPrice : undefined,
            fill_quantity:
              "fill" in result && result.fill
                ? (result.fill.absoluteFillQuantity ??
                  Math.abs(result.fill.fillQuantity))
                : undefined,
            commission:
              "fill" in result ? (result.fill?.orderFee?.value ?? 0) : 0,
            slippage: "fill" in result ? (result.fill?.slippage ?? 0) : 0,
            market_data_symbol:
              "fill" in result ? result.fill?.marketDataSymbol : undefined,
            market_data_age_ms:
              "fill" in result ? result.fill?.marketDataAgeMs : undefined,
            used_fill_forward_data:
              "fill" in result ? result.fill?.usedFillForwardData : undefined,
            reference_price:
              "fill" in result ? result.fill?.referencePrice : undefined,
            rejection_reason:
              "fill" in result ? result.fill?.rejectionReason : undefined,
            cash: simBroker.getCash(),
            positions: simBroker.getPositions(),
            pending_orders: simBroker.getOpenOrders(),
            total_equity: simBroker.getTotalEquity(),
          }),
        );
      }

      if (!side || !quantity) {
        return leanError("symbol, side, and quantity are required");
      }

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

      // NOTE: market data is symbol-scoped inside SimBroker; callers must NOT
      // inject a bar for pricing (that was the cross-symbol pricing defect).

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
      if (orderResult.orderId) {
        fill = simBroker.tryFillImmediateOrder(orderResult.orderId);
      }

      // Get updated state (for pending orders that weren't filled) - SYNCHRONOUS
      const cash = simBroker.getCash();
      const positions = simBroker.getPositions();
      const pendingOrders = simBroker.getOpenOrders();
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
      tradeResult.data.order_status = fill?.status ?? orderResult.status;
      tradeResult.data.fill_price = fill?.fillPrice;
      tradeResult.data.fill_quantity = fill
        ? (fill.absoluteFillQuantity ?? Math.abs(fill.fillQuantity))
        : undefined;
      tradeResult.data.commission = fill?.orderFee?.value ?? 0;
      tradeResult.data.slippage = fill?.slippage ?? 0;
      tradeResult.data.market_data_symbol = fill?.marketDataSymbol;
      tradeResult.data.market_data_age_ms = fill?.marketDataAgeMs;
      tradeResult.data.used_fill_forward_data = fill?.usedFillForwardData;
      tradeResult.data.reference_price = fill?.referencePrice;
      tradeResult.data.rejection_reason = fill?.rejectionReason;
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
    simBroker.releaseAllReservations();
    // Calculate metrics - ALL SYNCHRONOUS (no Redis!)
    const metrics = simBroker.getMetrics();
    const trades = simBroker.getTrades();
    const equityCurve = simBroker.getEquityCurve();
    const finalEquity = simBroker.getTotalEquity();

    // Persist to Supabase (only at the END of backtest)
    const supabaseClient = supabase;

    // Update backtest status
    await (supabaseClient as any)
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

      if (tradeRows.length > 0) {
        const { error: tradesError } = await (supabaseClient as any)
          .from("backtest_trades")
          .insert(tradeRows);

        if (tradesError) {
          console.error(
            "[BacktestExecutor] Failed to insert backtest_trades:",
            tradesError,
          );
        }
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
        const { error: snapshotError } = await (supabaseClient as any)
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
          const mtmEnvelope = toMarketBarEnvelope(symbol, params.current_bar);
          if (mtmEnvelope) simBroker.onBar(mtmEnvelope);
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
          return this.portfoliogetOpenOrders(simBroker);

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
    const realizedPnlValue = state.cumulativeRealizedPnl;
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

  private portfolioGetPosition(
    simBroker: SimBroker,
    symbol?: string,
  ): NodeResult {
    if (!symbol) {
      const state = simBroker.getPortfolioState();
      const positions = Object.values(state.positions).map((position) => ({
        ...formatPositionWithPnlPercent(position),
        realized_pnl: state.realizedPnlBySymbol[position.symbol] ?? 0,
      }));

      return leanSuccess({
        has_position: positions.length > 0,
        positions,
        positions_count: positions.length,
      });
    }

    const position = simBroker.getPosition(symbol);
    const formattedPosition = position
      ? formatPositionWithPnlPercent(position)
      : null;
    const positionCostBasis = position
      ? Math.abs(position.avgFillPrice * position.quantity)
      : 0;
    const unrealizedPnlValue = position?.unrealizedPnl || 0;
    const realizedPnlValue =
      simBroker.getPortfolioState().realizedPnlBySymbol[symbol] ?? 0;

    return leanSuccess({
      has_position: !!position,
      position: formattedPosition,
      symbol,
      quantity: position?.quantity || 0,
      side: position?.side || null,
      avg_entry_price: position?.avgFillPrice || 0,
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
      buying_power: simBroker.getAvailableBuyingPower(),
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

  private portfoliogetOpenOrders(simBroker: SimBroker): NodeResult {
    const orders = simBroker.getOpenOrders();

    return leanSuccess({
      pending_orders: orders,
      count: orders.length,
    });
  }

  private portfolioGetTrades(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const trades = simBroker.getTrades();

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: state.cumulativeRealizedPnl,
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
