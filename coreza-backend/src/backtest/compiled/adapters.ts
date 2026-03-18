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

import { INodeExecutor, NodeResult, WorkflowNode } from "../../nodes/types";
import { resolveCategory } from "../../nodes/categoryMap";
import { ExecFn, CompiledExecContext } from "./types";

export { resolveCategory };

export function buildExecAdapter(executor: INodeExecutor): ExecFn {
  return (
    node: WorkflowNode,
    input: any,
    resolvedParams: Record<string, any>,
    ctx: CompiledExecContext,
  ): NodeResult => {
    ctx.nodeId = node.id;
    ctx.resolvedParams = resolvedParams;

    const result = executor.execute(node, input, ctx);

    if (result && typeof (result as any).then === "function") {
      throw new Error(
        `Compiled plan requires synchronous executor for category ${executor.category} (node ${node.id})`,
      );
    }

    const syncResult = result as NodeResult;
    if (syncResult && typeof syncResult === "object" && "success" in syncResult) {
      if (!syncResult.success) {
        throw new Error(syncResult.error || `Node execution failed: ${executor.category}`);
      }
      return syncResult;
    }

    return { data: (syncResult as any)?.data ?? syncResult };
  };
}
