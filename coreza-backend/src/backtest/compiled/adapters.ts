/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeResult, WorkflowNode } from "../../nodes/types";
import { resolveCategory } from "../../nodes/categoryMap";
import { ExecFn, CompiledExecContext } from "./types";
import { enforceWarmupPolicy } from "../warmup/WarmupPolicy";

export { resolveCategory };

export function buildExecAdapter(executor: INodeExecutor): ExecFn {
  if (executor.syncCapable !== true) {
    return async (
      node: WorkflowNode,
      input: any,
      resolvedParams: Record<string, any>,
      ctx: CompiledExecContext,
    ): Promise<NodeResult> => {
      ctx.nodeId = node.id;
      ctx.resolvedParams = resolvedParams;

      const warmupResult = ctx.isWarmingUp
        ? enforceWarmupPolicy(node)
        : undefined;
      const result =
        warmupResult ?? (await executor.execute(node, input, ctx));

      return normalizeResult(result, executor);
    };
  }

  return (
    node: WorkflowNode,
    input: any,
    resolvedParams: Record<string, any>,
    ctx: CompiledExecContext,
  ): NodeResult => {
    ctx.nodeId = node.id;
    ctx.resolvedParams = resolvedParams;

    const result =
      (ctx.isWarmingUp ? enforceWarmupPolicy(node) : undefined) ??
      executor.execute(node, input, ctx);

    if (result && typeof (result as any).then === "function") {
      return {
        success: false,
        data: null,
        error: `Compiled plan requires synchronous executor for category ${executor.category} (node ${node.id})`,
      };
    }

    return normalizeResult(result as NodeResult, executor);
  };
}

function normalizeResult(
  syncResult: NodeResult,
  executor: INodeExecutor,
): NodeResult {
  if (
    syncResult &&
    typeof syncResult === "object" &&
    "success" in syncResult
  ) {
    if (!syncResult.success) {
      return {
        success: false,
        data: null,
        error:
          syncResult.error || `Node execution failed: ${executor.category}`,
        meta: syncResult.meta,
        control: syncResult.control,
      };
    }
    return syncResult;
  }

  return { data: (syncResult as any)?.data ?? syncResult };
}
