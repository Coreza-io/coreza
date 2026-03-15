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
import { IndicatorService } from "../../services/indicators";
import { extractPrices } from "../../services/toolOutputProcessor";
import { DataContext } from "../../services/DataContext";
import {
  normalizeOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import {
  IndicatorStateManager,
  buildIndicatorKey,
} from "../../services/indicatorStateManager";
import { InitializeIndicatorsExecutor } from "./InitializeIndicatorsExecutor";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";
  private readonly initExecutor = new InitializeIndicatorsExecutor();
  private readonly indicatorKeyCache = new Map<string, string>();
  private readonly indicatorResults = new Map<string, NodeResult>();
  private cachedRunId: string | null = null;


  executeSync(node: WorkflowNode, input: NodeInput, context?: any): NodeResult {
    const runId = context?.runId;
    if (runId && runId !== this.cachedRunId) {
      this.indicatorKeyCache.clear();
      this.indicatorResults.clear();
      this.cachedRunId = runId;
    }

    const indicatorType = (node.name || node.node_type)?.toLowerCase();
    if (indicatorType === "initializeindicators") {
      return toNodeResult(createErrorOutput("InitializeIndicators requires async execution"));
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
        let key = this.indicatorKeyCache.get(node.id);
        if (!key) {
          key = buildIndicatorKey(userId, workflowId, runId, symbol, timeframe, node.id);
          this.indicatorKeyCache.set(node.id, key);
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

    return toNodeResult(
      createErrorOutput("Sync execution path unavailable for indicator input", {
        nodeId: node.id,
        nodeName: node.name,
        category: this.category,
      }),
    );
  }

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    //const startTime = Date.now();
    try {
      const runId = context?.runId;
      if (runId && runId !== this.cachedRunId) {
        this.indicatorKeyCache.clear();
        this.indicatorResults.clear();
        this.cachedRunId = runId;
      }
      const indicatorType = (node.name || node.node_type)?.toLowerCase();

      // Delegate to InitializeIndicatorsExecutor
      if (indicatorType === "initializeindicators") {
        return this.initExecutor.execute(node, input, context);
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
        if (!context?.silent) {
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
        let symbol = String(processedParams.symbol || "");
        let timeframe = String(processedParams.timeframe || "");

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
          let key = this.indicatorKeyCache.get(node.id);
          if (!key) {
            key = buildIndicatorKey(
              userId,
              workflowId,
              runId,
              symbol,
              timeframe,
              node.id,
            );
            this.indicatorKeyCache.set(node.id, key);
          }

          const isBacktest = !!context?.silent;

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
                state = await stateManager.update(key, latestBar, false);
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
      const normalized = createErrorOutput(
        error instanceof Error ? error : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
          startTime,
        },
      );
      return toNodeResult(normalized);
    }
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
