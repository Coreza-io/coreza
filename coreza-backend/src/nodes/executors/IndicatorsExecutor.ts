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
import { VectorizedIndicatorsService } from "../../services/vectorizedIndicators";

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

      if (indicatorType === "vectorizedindicators") {
        const result = await VectorizedIndicatorsService.enrichBarsWithIndicators(
          resolvedParams.candle_data,
          {
            indicators: resolvedParams.indicators,
            rsi_period: Number(resolvedParams.rsi_period),
            ema_period: Number(resolvedParams.ema_period),
            sma_period: Number(resolvedParams.sma_period),
            macd_fast: Number(resolvedParams.macd_fast),
            macd_slow: Number(resolvedParams.macd_slow),
            macd_signal: Number(resolvedParams.macd_signal),
            bb_period: Number(resolvedParams.bb_period),
            bb_stddev: Number(resolvedParams.bb_stddev),
            stoch_k: Number(resolvedParams.stoch_k),
            stoch_d: Number(resolvedParams.stoch_d),
            adx_period: Number(resolvedParams.adx_period),
          }
        );

        if (!result.success) {
          return { success: false, error: "vectorizedindicators calculation failed" };
        }

        return result;
      }

      console.log(
        `🔢 Executing ${indicatorType} indicator with params:`,
        resolvedParams
      );

      const result = await IndicatorService.calculate(
        indicatorType,
        resolvedParams
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
