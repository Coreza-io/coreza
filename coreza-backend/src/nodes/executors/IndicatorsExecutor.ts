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
import { IndicatorService, CandleData } from "../../services/indicators";
import IndicatorStateManager from "../../services/IndicatorStateManager";
import { resolveDataRef, extractPrices } from "../../services/toolOutputProcessor";
import { DataContext } from "../../services/DataContext";
import { normalizeOutput, createErrorOutput, toNodeResult } from "../../utils/normalizeOutput";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const indicatorType = (node.name || node.node_type)?.toLowerCase();
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Get DataContext if available (from AI Agent execution)
      const dataContext = context?.dataContext as DataContext | undefined;

      // Resolve dataRef to actual data if present
      let processedParams = { ...resolvedParams };
      
      // Check for dataRef in multiple possible locations (dataRef field or candle_data field from LLM)
      const dataRefValue = resolvedParams.dataRef || 
        (typeof resolvedParams.candle_data === 'string' && resolvedParams.candle_data.startsWith('bars:') 
          ? resolvedParams.candle_data 
          : null);

      if (dataContext && dataRefValue) {
        console.log(`🔗 [Indicators] Resolving dataRef: ${dataRefValue}`);
        const barsData = dataContext.getDataByKey(dataRefValue);
        
      if (Array.isArray(barsData)) {
          // Extract close prices from bars for indicator calculation
          const closePrices = extractPrices(barsData, 'close');
          
          // Set fields that IndicatorService expects
          processedParams.candle_data = barsData;  // For ADX, Stoch, VWAP, OBV, Ichimoku
          processedParams.prices = closePrices;     // For RSI, EMA, SMA, MACD, BB
          
          // Keep existing fields for compatibility
          processedParams.data = closePrices;
          processedParams.values = closePrices;
          processedParams.bars = barsData;
          processedParams.open = extractPrices(barsData, 'open');
          processedParams.high = extractPrices(barsData, 'high');
          processedParams.low = extractPrices(barsData, 'low');
          processedParams.close = closePrices;
          processedParams.volume = barsData.map(bar => bar.volume || bar.v || bar.vol || 0);
          
          console.log(`📊 [Indicators] Resolved ${closePrices.length} data points from dataRef`);
        }
      }

      console.log(
        `🔢 Executing ${indicatorType} indicator with ${processedParams.data?.length || 0} data points`
      );

      const isStreamingMode = context?.trigger === "market_data" && !!context?.initialInput?.data?.bar;

      let result;
      if (isStreamingMode) {
        const incomingBar = context.initialInput.data.bar as CandleData;
        const incomingMeta = context.initialInput.data.bar as Record<string, any>;
        const symbol = String(processedParams.symbol || incomingMeta?.symbol || "unknown");
        const interval = String(processedParams.interval || incomingMeta?.interval || "unknown");
        const stateKey = IndicatorStateManager.buildStateKey(
          String(context.workflowId || "unknown"),
          String(node.id || "unknown"),
          symbol,
          interval,
        );

        const hasState = await IndicatorService.hasPersistedState(stateKey);
        if (hasState) {
          const incremental = await IndicatorService.updateIncremental(
            indicatorType,
            stateKey,
            incomingBar,
            processedParams,
          );

          if (incremental.success) {
            result = incremental;
          } else {
            await IndicatorStateManager.deleteState(stateKey);
            const historicalBars = Array.isArray(processedParams.candle_data)
              ? processedParams.candle_data
              : incomingBar
                ? [incomingBar]
                : [];
            result = await IndicatorService.initializeAndSave(
              indicatorType,
              stateKey,
              historicalBars,
              processedParams,
            );
          }
        } else {
          const historicalBars = Array.isArray(processedParams.candle_data)
            ? processedParams.candle_data
            : incomingBar
              ? [incomingBar]
              : [];
          result = await IndicatorService.initializeAndSave(
            indicatorType,
            stateKey,
            historicalBars,
            processedParams,
          );
        }
      } else {
        result = await IndicatorService.calculate(
          indicatorType,
          processedParams
        );
      }

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
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(normalized);
    }
  }
}
