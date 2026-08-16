/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { IndicatorService } from "../../nodes/logic/indicators";
import { extractPrices } from "../../nodes/logic/toolOutputProcessor";
import { DataContext, DataContextManager } from "../../engine/DataContext";
import {
  normalizeOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import { IndicatorStateManager, buildIndicatorKey } from "../../engine";
import { InitializeIndicatorsExecutor } from "./InitializeIndicatorsExecutor";
import { buildExecutionScopedKey } from "../../utils/executionKey";
import { RollingWindow } from "../../engine/RollingWindow";
import {
  buildRollingWindowPayload,
  clampWindowSize,
  normalizeSymbol,
  normalizeTimeframe,
  parseCandleData,
  ROLLING_WINDOW_ERRORS,
  buildRollingWindowNotFoundPayload,
} from "../../engine/rollingWindowHelpers";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";
  readonly syncCapable = true;
  private readonly initExecutor = new InitializeIndicatorsExecutor();
  private readonly indicatorKeyCache = new Map<string, string>();
  private readonly indicatorResults = new Map<string, NodeResult>();
  private readonly rollingWindowKeyCache = new Map<string, string>();
  private readonly rollingWindowResults = new Map<string, NodeResult>();
  private cachedRunId: string | null = null;

  private getIndicatorCacheKey(
    nodeId: string,
    symbol: string,
    timeframe: string,
  ): string {
    return `${nodeId}:${symbol}:${timeframe}`;
  }

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    const runId = context?.runId;
    if (runId && runId !== this.cachedRunId) {
      this.indicatorKeyCache.clear();
      this.indicatorResults.clear();
      this.rollingWindowKeyCache.clear();
      this.rollingWindowResults.clear();
      this.cachedRunId = runId;
    }

    const indicatorType = (node.name || node.node_type)?.toLowerCase();
    if (indicatorType === "initializeindicators") {
      return this.executeAsync(node, input, context);
    }

    if (indicatorType === "rollingwindow") {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      return this.executeRollingWindowNode(node, resolvedParams, context);
    }

    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const processedParams = { ...resolvedParams };
    const rawCandle = resolvedParams.candle_data;
    const candleData = Array.isArray(rawCandle)
      ? rawCandle
      : rawCandle && typeof rawCandle === "object"
        ? [rawCandle]
        : JSON.parse(rawCandle || "[]");

    const dataContext = context?.dataContext as DataContext | undefined;
    if (dataContext && candleData) {
      const barsData = Array.isArray(candleData) ? candleData : [candleData];
      processedParams.candle_data = barsData;

      const stateManager = context?.indicatorStateManager as
        | IndicatorStateManager
        | undefined;
      const userId = context?.userId || context?.user_id;
      const workflowId = context?.workflowId;
      const runId = context?.runId || context?.user_id;
      const symbol = String(processedParams.symbol || "");
      const timeframe = String(processedParams.timeframe || "");

      if (
        stateManager &&
        userId &&
        workflowId &&
        runId &&
        symbol &&
        timeframe &&
        barsData.length > 0
      ) {
        const cacheKey = this.getIndicatorCacheKey(node.id, symbol, timeframe);
        let key = this.indicatorKeyCache.get(cacheKey);
        if (!key) {
          key = buildIndicatorKey(
            userId,
            workflowId,
            runId,
            symbol,
            timeframe,
            node.id,
          );
          this.indicatorKeyCache.set(cacheKey, key);
        }

        let state = stateManager.getStateSync(key);
        if (!state) {
          return toNodeResult(
            createErrorOutput("Indicator state not warmed for sync execution", {
              nodeId: node.id,
              nodeName: node.name,
              category: this.category,
            }),
          );
        }

        const latestBar = barsData[barsData.length - 1];
        const latestBarTime = String(latestBar?.time ?? "");
        if (latestBarTime && latestBarTime !== state.lastBarTime) {
          state = stateManager.updateSync(key, latestBar);
        }

        return this.getCachedIndicatorResult(node.id, state);
      }
    }

    return this.executeAsync(node, input, context);
  }

  private async executeAsync(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const runId = context?.runId;
      if (runId && runId !== this.cachedRunId) {
        this.indicatorKeyCache.clear();
        this.indicatorResults.clear();
        this.rollingWindowKeyCache.clear();
        this.rollingWindowResults.clear();
        this.cachedRunId = runId;
      }
      const indicatorType = (node.name || node.node_type)?.toLowerCase();

      // Delegate to InitializeIndicatorsExecutor
      if (indicatorType === "initializeindicators") {
        return this.initExecutor.execute(node, input, {
          ...context,
          indicatorKeyCache: this.indicatorKeyCache,
        });
      }

      if (indicatorType === "rollingwindow") {
        const resolvedParams = context?.resolveNodeParameters
          ? context.resolveNodeParameters(node, input)
          : { ...node.values, ...input };
        return this.executeRollingWindowNode(node, resolvedParams, context);
      }

      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Get DataContext if available (from AI Agent execution)
      const dataContext = context?.dataContext as DataContext | undefined;

      // Resolve dataRef to actual data if present
      const processedParams = { ...resolvedParams };

      const rawCandle = resolvedParams.candle_data;
      const candleData = Array.isArray(rawCandle)
        ? rawCandle
        : rawCandle && typeof rawCandle === "object"
          ? [rawCandle]
          : JSON.parse(rawCandle || "[]");

      // Check for dataRef in multiple possible locations (dataRef field or candle_data field from LLM)
      // const dataRefValue = resolvedParams.dataRef ||
      //   (typeof resolvedParams.candle_data === 'string' && resolvedParams.candle_data.startsWith('bars:')
      //     ? resolvedParams.candle_data
      //     : null);

      if (dataContext && candleData) {
        if (context?.executionMode !== "backtest") {
          console.log(
            `[Indicators] Resolving dataRef: ${Array.isArray(candleData) ? `${candleData.length} bars` : typeof candleData}`,
          );
        }
        //const barsData = dataContext.getDataByKey(candleData);
        const barsData = Array.isArray(candleData) ? candleData : [candleData];

        // Extract close prices from bars for indicator calculation
        // const closePrices = extractPrices(barsData, "close");

        // Set fields that IndicatorService expects
        processedParams.candle_data = barsData; // For ADX, Stoch, VWAP, OBV, Ichimoku
        // processedParams.prices = closePrices; // For RSI, EMA, SMA, MACD, BB

        // // Keep existing fields for compatibility
        // processedParams.data = closePrices;
        // processedParams.values = closePrices;
        // processedParams.bars = barsData;
        // processedParams.open = extractPrices(barsData, "open");
        // processedParams.high = extractPrices(barsData, "high");
        // processedParams.low = extractPrices(barsData, "low");
        // processedParams.close = closePrices;
        // processedParams.volume = barsData.map(
        //   (bar) => bar.volume || bar.v || bar.vol || 0,
        // );

        // console.log(
        //   `📊 [Indicators] Resolved ${closePrices.length} data points from dataRef`,
        // );

        const stateManager = context?.indicatorStateManager as
          | IndicatorStateManager
          | undefined;
        const userId = context?.userId || context?.user_id;
        const workflowId = context?.workflowId;
        const runId = context?.runId || context?.user_id;
        const symbol = String(processedParams.symbol || "");
        const timeframe = String(processedParams.timeframe || "");

        // Fallback for legacy workflows where symbol/timeframe fields are not set explicitly.
        // if ((!symbol || !timeframe) && barsData) {
        //   const parts = barsData.split(":");
        //   if (parts.length >= 4) {
        //     if (!symbol) symbol = parts[1];
        //     if (!timeframe) timeframe = parts[2];
        //   }
        // }

        if (
          stateManager &&
          userId &&
          workflowId &&
          runId &&
          symbol &&
          timeframe &&
          barsData.length > 0
        ) {
          // const indicatorParams =
          //   this.extractIndicatorParams(processedParams);
          const cacheKey = this.getIndicatorCacheKey(
            node.id,
            symbol,
            timeframe,
          );
          let key = this.indicatorKeyCache.get(cacheKey);
          if (!key) {
            key = buildIndicatorKey(
              userId,
              workflowId,
              runId,
              symbol,
              timeframe,
              node.id,
            );
            this.indicatorKeyCache.set(cacheKey, key);
          }

          const isBacktest = context?.executionMode === "backtest";

          let state;
          if (isBacktest) {
            state = stateManager.getStateSync(key);
            if (!state) {
              state = await stateManager.warmUp(
                key,
                indicatorType,
                processedParams,
                barsData,
                true,
              );
            } else {
              const latestBar = barsData[barsData.length - 1];
              const latestBarTime = String(latestBar?.time ?? "");
              if (latestBarTime && latestBarTime !== state.lastBarTime) {
                state = stateManager.updateSync(key, latestBar);
              }
            }
          } else {
            state = await stateManager.getState(key);
            if (!state) {
              state = await stateManager.warmUp(
                key,
                indicatorType,
                processedParams,
                barsData,
                false,
              );
            } else {
              const latestBar = barsData[barsData.length - 1];
              const latestBarTime = String(latestBar?.time ?? "");
              if (latestBarTime && latestBarTime !== state.lastBarTime) {
                state = await stateManager.update(key, latestBar, true);
              }
            }
          }

          return this.getCachedIndicatorResult(node.id, state);
        }
      }

      console.log(
        `🔢 Executing ${indicatorType} indicator with ${processedParams.data?.length || 0} data points`,
      );

      const result = await IndicatorService.calculate(
        indicatorType,
        processedParams,
      );

      const normalized = normalizeOutput(result, {
        nodeId: node.id,
        nodeName: node.name,
        category: this.category,
        startTime,
      });
      return toNodeResult(normalized);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error
          ? error
          : typeof error === "object" && error !== null
            ? ((error as any).message ?? JSON.stringify(error))
            : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
        },
      );

      return toNodeResult(errOutput);
    }
  }

  private executeRollingWindowNode(
    node: WorkflowNode,
    params: Record<string, any>,
    context?: any,
  ): NodeResult {
    const operation = params.operation ?? "set";
    const requestedSymbol = normalizeSymbol(params.symbol);
    const requestedTimeframe = normalizeTimeframe(params.timeframe);
    if (operation === "get") {
      if (!requestedSymbol) {
        return toNodeResult(
          createErrorOutput(ROLLING_WINDOW_ERRORS.symbolRequired, {
            nodeId: node.id,
            nodeName: "RollingWindow",
            category: this.category,
          }),
        );
      }

      if (!requestedTimeframe) {
        return toNodeResult(
          createErrorOutput(ROLLING_WINDOW_ERRORS.timeframeRequired, {
            nodeId: node.id,
            nodeName: "RollingWindow",
            category: this.category,
          }),
        );
      }

      const { userId, workflowId, runId, dataContext } =
        this.resolveRollingWindowContext(params, context);
      const rollingCacheKey = `${userId}:${workflowId}:${runId}:${requestedSymbol}:${requestedTimeframe}`;
      let storeKey = this.rollingWindowKeyCache.get(rollingCacheKey);
      if (!storeKey) {
        storeKey = buildExecutionScopedKey({
          userId,
          workflowId,
          runId,
          scope: "rolling_window",
          parts: [requestedSymbol, requestedTimeframe],
        });
        this.rollingWindowKeyCache.set(rollingCacheKey, storeKey);
      }
      const window = dataContext.getDataByKey(storeKey) as
        | RollingWindow<unknown>
        | undefined;

      if (!window) {
        return {
          success: false,
          data: buildRollingWindowNotFoundPayload(
            requestedSymbol,
            requestedTimeframe,
          ),
          meta: {
            key: storeKey,
            timeframe: requestedTimeframe,
          },
        };
      }

      return {
        success: true,
        data: buildRollingWindowPayload(window),
        meta: {
          key: storeKey,
          timeframe: requestedTimeframe,
        },
      };
    }

    const size = clampWindowSize(params.size);
    const symbol = requestedSymbol || "_";
    const timeframe = requestedTimeframe || "_";

    const parsed = parseCandleData(params.candle_data);
    if (!parsed.ok) {
      return toNodeResult(
        createErrorOutput(parsed.error, {
          nodeId: node.id,
          nodeName: "RollingWindow",
          category: this.category,
        }),
      );
    }

    const { userId, workflowId, runId, dataContext } =
      this.resolveRollingWindowContext(params, context);
    const rollingCacheKey = `${userId}:${workflowId}:${runId}:${symbol}:${timeframe}`;
    let storeKey = this.rollingWindowKeyCache.get(rollingCacheKey);
    if (!storeKey) {
      storeKey = buildExecutionScopedKey({
        userId,
        workflowId,
        runId,
        scope: "rolling_window",
        parts: [symbol, timeframe],
      });
      this.rollingWindowKeyCache.set(rollingCacheKey, storeKey);
    }

    let window = dataContext.getDataByKey(storeKey) as
      | RollingWindow<unknown>
      | undefined;
    if (!window || window.size !== size) {
      window = new RollingWindow(size);
      dataContext.setData(storeKey, window);
    }

    for (const bar of parsed.bars) {
      window.add(bar);
    }
    const payload = buildRollingWindowPayload(window);
    const rw = this.rollingWindowResults.get(node.id) ?? {
      success: true,
      data: {},
    };
    Object.assign(rw.data, payload);
    this.rollingWindowResults.set(node.id, rw);
    return rw;
  }

  private resolveRollingWindowContext(
    params: Record<string, any>,
    context?: any,
  ): {
    userId: string;
    workflowId: string;
    runId: string;
    dataContext: DataContext;
  } {
    const userId =
      context?.userId ||
      context?.user_id ||
      params.userId ||
      params.user_id ||
      "system";
    const workflowId =
      context?.workflowId ||
      context?.workflow_id ||
      params.workflowId ||
      params.workflow_id ||
      "manual";
    const runId =
      context?.runId ||
      context?.executionId ||
      params.executionId ||
      params.execution_id ||
      params.run_id ||
      "manual";
    const injectedDataContext = context?.dataContext as DataContext | undefined;
    const dataContext =
      injectedDataContext ??
      DataContextManager.getInstance().getContext({
        executionId: runId,
        workflowId,
        userId,
      });

    return { userId, workflowId, runId, dataContext };
  }

  private extractIndicatorParams(
    params: Record<string, any>,
  ): Record<string, any> {
    const allowedParams = [
      "period",
      "window",
      "fastPeriod",
      "slowPeriod",
      "signalPeriod",
      "stdDev",
      "std_dev_multiplier",
      "k_period",
      "d_period",
      "session_type",
      "custom_start_time",
      "method",
    ];

    return allowedParams.reduce(
      (acc, key) => {
        if (params[key] !== undefined && params[key] !== null) {
          acc[key] = params[key];
        }
        return acc;
      },
      {} as Record<string, any>,
    );
  }

  private getCachedIndicatorResult(
    nodeId: string,
    state: { currentValue: any; previousValue: any },
  ): NodeResult {
    if (!this.indicatorResults.has(nodeId)) {
      this.indicatorResults.set(nodeId, {
        success: true,
        data: {
          currentValue: null,
          previousValue: null,
        },
      });
    }
    const result = this.indicatorResults.get(nodeId)!;
    result.data.currentValue = state.currentValue;
    result.data.previousValue = state.previousValue;
    return result;
  }
}
