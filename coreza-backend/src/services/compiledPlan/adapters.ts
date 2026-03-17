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

import { WorkflowNode, INodeExecutor, NodeResult } from "../../nodes/types";
import { ExecFn, CompiledExecContext } from "./types";

/**
 * Compiled Plan Adapters
 * ======================
 * Wraps INodeExecutor.execute() into the ExecFn signature
 * used by the compiled plan VM. The adapter overrides ctx.resolveNodeParameters
 * to return pre-resolved params, avoiding redundant template resolution.
 */

const CATEGORY_MAP: Record<string, string> = {
  If: "ControlFlow",
  Switch: "ControlFlow",
  "Edit Fields": "ControlFlow",
  Compute: "ControlFlow",
  Loop: "ControlFlow",
  Scheduler: "Utility",
  trigger: "Utility",
  Visualize: "Utility",
  webhook: "Utility",
  httprequest: "Utility",
  Gmail: "Communication",
  WhatsApp: "Communication",
  FinnHub: "DataSource",
  YahooFinance: "DataSource",
  Store: "DataSource",
  RollingWindow: "Indicators",
  LLM: "LLM",
  AIAgent: "AIAgent",
  InitializeIndicators: "Indicators",
};

/**
 * Resolve the executor category for a node, using the same
 * CATEGORY_MAP as WorkflowEngine.
 */
export function resolveCategory(node: WorkflowNode): string {
  const nodeName = node.name ?? "";
  return CATEGORY_MAP[nodeName] ?? node.category;
}

/**
 * Build an ExecFn adapter that wraps executor.execute().
 *
 * The adapter:
 * 1. Sets ctx.nodeId to the current node
 * 2. Overrides ctx.resolveNodeParameters to return pre-resolved params
 * 3. Calls executor.execute(node, input, ctx)
 * 4. Normalizes the result
 */
export function buildExecAdapter(
  executor: INodeExecutor,
): ExecFn {
  return (
    node: WorkflowNode,
    input: any,
    resolvedParams: Record<string, any>,
    ctx: CompiledExecContext,
  ): NodeResult => {
    // Point context to current node
    ctx.nodeId = node.id;

    // Expose pre-resolved params via context field; resolveNodeParameters is stable.
    ctx.resolvedParams = resolvedParams;

    const result = executor.execute(node, input, ctx);

    if (result && typeof (result as any).then === "function") {
      throw new Error(
        `Compiled plan requires synchronous executor for category ${executor.category} (node ${node.id})`,
      );
    }

    const syncResult = result as NodeResult;

    // Normalize result (same as WorkflowEngine.executeNode)
    if (syncResult && typeof syncResult === "object" && "success" in syncResult) {
      if (!syncResult.success) {
        throw new Error(syncResult.error || `Node execution failed: ${executor.category}`);
      }
      return syncResult;
    }

    return { data: (syncResult as any)?.data ?? syncResult };
  };
}
