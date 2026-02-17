/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode, WorkflowEdge } from "../types";
import {
  IndicatorStateManager,
  buildIndicatorKey,
} from "../../services/indicatorStateManager";
import {
  normalizeOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";

const INDICATOR_NAMES = new Set([
  "RSI", "EMA", "SMA", "MACD", "BB", "BOLLINGERBANDS",
  "ADX", "STOCH", "VWAP", "OBV", "ICHIMOKU",
  "VOLUMEOSCILLATOR", "SUPPORTRESISTANCE", "ATR",
]);

interface DiscoveredIndicator {
  nodeId: string;
  type: string;
  params: Record<string, any>;
}

/**
 * BFS walk from startNodeId through all downstream edges to discover
 * every indicator node in the workflow graph.
 */
function discoverIndicators(
  startNodeId: string,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[],
): DiscoveredIndicator[] {
  const indicators: DiscoveredIndicator[] = [];
  const visited = new Set<string>();
  const queue = allEdges
    .filter((e) => e.source === startNodeId)
    .map((e) => e.target);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const name = (node.name || "").toUpperCase().replace(/\s+/g, "");
    if (INDICATOR_NAMES.has(name)) {
      indicators.push({
        nodeId: node.id,
        type: (node.name || "").toLowerCase(),
        params: node.values || (node.data?.values ?? {}),
      });
    }

    // Continue BFS
    allEdges
      .filter((e) => e.source === nodeId)
      .forEach((e) => {
        if (!visited.has(e.target)) queue.push(e.target);
      });
  }

  return indicators;
}

export class InitializeIndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // --- Parse inputs ---
      const symbol = String(resolvedParams.symbol || "");
      const timeframe = String(resolvedParams.timeframe || "");
      const warmupPeriodRaw = parseInt(resolvedParams.warmup_period) || 200;
      const autoDetect = String(resolvedParams.auto_detect ?? "true") === "true";

      const candleData = Array.isArray(resolvedParams.candle_data)
        ? resolvedParams.candle_data
        : JSON.parse(resolvedParams.candle_data || "[]");

      if (!Array.isArray(candleData) || candleData.length === 0) {
        const normalized = createErrorOutput(
          new Error("candle_data is required and must be a non-empty array of OHLCV bars"),
          { nodeId: node.id, nodeName: node.name, category: this.category, startTime },
        );
        return toNodeResult(normalized);
      }

      if (!symbol || !timeframe) {
        const normalized = createErrorOutput(
          new Error("symbol and timeframe are required fields"),
          { nodeId: node.id, nodeName: node.name, category: this.category, startTime },
        );
        return toNodeResult(normalized);
      }

      // --- Retrieve execution context ---
      const stateManager = context?.indicatorStateManager as IndicatorStateManager | undefined;
      const userId = context?.userId || context?.user_id;
      const workflowId = context?.workflowId;
      const runId = context?.runId || context?.user_id;

      if (!stateManager) {
        const normalized = createErrorOutput(
          new Error("IndicatorStateManager not available in execution context"),
          { nodeId: node.id, nodeName: node.name, category: this.category, startTime },
        );
        return toNodeResult(normalized);
      }

      // --- Discover indicators ---
      let discoveredIndicators: DiscoveredIndicator[] = [];

      if (autoDetect) {
        const allNodes: WorkflowNode[] = context?.nodes || [];
        const allEdges: WorkflowEdge[] = context?.edges || [];

        if (allNodes.length === 0) {
          console.warn("[InitializeIndicators] No workflow nodes found in context, cannot auto-detect indicators");
        } else {
          discoveredIndicators = discoverIndicators(node.id, allNodes, allEdges);
        }
      }

      if (discoveredIndicators.length === 0) {
        console.warn("[InitializeIndicators] No indicator nodes discovered in workflow");
        const normalized = normalizeOutput({
          success: true,
          data: {
            warmup_completed: true,
            warmup_bars_used: 0,
            remaining_bars: candleData,
            remaining_bars_count: candleData.length,
            indicators_initialized: 0,
            indicators: {},
            symbol,
            timeframe,
            message: "No indicator nodes found downstream. Passing all bars through.",
          },
        });
        return toNodeResult(normalized);
      }

      // --- Slice bars ---
      const warmupPeriod = Math.min(warmupPeriodRaw, candleData.length);
      const warmupBars = candleData.slice(0, warmupPeriod);
      const remainingBars = candleData.slice(warmupPeriod);

      console.log(
        `[InitializeIndicators] Warming up ${discoveredIndicators.length} indicators with ${warmupBars.length} bars (${remainingBars.length} remaining)`,
      );

      // --- Warm up each indicator ---
      const results: Record<string, any> = {};

      for (const ind of discoveredIndicators) {
        const indParams = {
          ...ind.params,
          symbol,
          timeframe,
          candle_data: warmupBars,
        };

        const key = buildIndicatorKey(
          userId,
          workflowId,
          runId,
          symbol,
          timeframe,
          ind.type,
        );

        try {
          const state = await stateManager.warmUp(
            key,
            ind.type,
            indParams,
            warmupBars,
            false,
          );

          results[ind.type] = {
            nodeId: ind.nodeId,
            indicator: ind.type,
            warmupBars: warmupBars.length,
            isReady: state.warmupCompleted,
            currentValue: state.value,
          };

          console.log(
            `  ✓ ${ind.type} warmed up (value: ${JSON.stringify(state.value)?.slice(0, 80)})`,
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`  ✗ ${ind.type} warmup failed: ${errMsg}`);
          results[ind.type] = {
            nodeId: ind.nodeId,
            indicator: ind.type,
            warmupBars: warmupBars.length,
            isReady: false,
            error: errMsg,
          };
        }
      }

      const readyCount = Object.values(results).filter((r: any) => r.isReady).length;

      const normalized = normalizeOutput({
        success: true,
        data: {
          warmup_completed: true,
          warmup_bars_used: warmupPeriod,
          remaining_bars: remainingBars,
          remaining_bars_count: remainingBars.length,
          indicators_initialized: readyCount,
          indicators_total: discoveredIndicators.length,
          indicators: results,
          symbol,
          timeframe,
        },
      });
      return toNodeResult(normalized);
    } catch (error) {
      const normalized = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime },
      );
      return toNodeResult(normalized);
    }
  }
}
