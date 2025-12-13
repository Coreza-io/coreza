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
import { resolveDataRef, extractPrices } from "../../services/toolOutputProcessor";
import { DataContext } from "../../services/DataContext";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const indicatorType = (node.name || node.node_type)?.toLowerCase();
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Get DataContext if available (from AI Agent execution)
      const dataContext = context?.dataContext as DataContext | undefined;

      // Resolve dataRef to actual data if present
      let processedParams = { ...resolvedParams };
      
      if (dataContext && resolvedParams.dataRef) {
        console.log(`🔗 [Indicators] Resolving dataRef: ${resolvedParams.dataRef}`);
        const barsData = resolveDataRef(resolvedParams, dataContext);
        
        if (Array.isArray(barsData)) {
          // Extract close prices from bars for indicator calculation
          const closePrices = extractPrices(barsData, 'close');
          processedParams.data = closePrices;
          processedParams.values = closePrices;
          
          // Also provide OHLCV for indicators that need it (e.g., VWAP, OBV)
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

      const result = await IndicatorService.calculate(
        indicatorType,
        processedParams
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${indicatorType} calculation failed`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Indicator execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
