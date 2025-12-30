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
import { ComputeService } from "../../services/compute";
import { LoopExecutorV2 } from "./LoopExecutorV2";
import { ComparatorService } from "../../services/comparator";
import { normalizeOutput, createSuccessOutput, createErrorOutput, toNodeResult } from "../../utils/normalizeOutput";

export class ControlFlowExecutor implements INodeExecutor {
  readonly category = "ControlFlow";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const nodeName = node.name;
      let result: NodeResult;
      switch (nodeName) {
        case "If":
          result = await this.executeIfNode(node, input, context);
          break;
        case "Switch":
          result = await this.executeSwitchNode(node, input, context);
          break;
        case "Edit Fields":
          result = await this.executeFieldNode(node, input, context);
          break;
        case "Compute":
          result = await this.executeComputeNode(node, input, context);
          break;
        case "Loop":
          result = await this.executeLoopNode(node, input, context);
          break;
        default:
          const errOutput = createErrorOutput(
            `Unsupported control flow node type: ${nodeName}`,
            { nodeId: node.id, nodeName, category: this.category, startTime }
          );
          return toNodeResult(errOutput);
      }

      const normalized = normalizeOutput(result, {
        nodeId: node.id,
        nodeName,
        category: this.category,
        startTime,
      });
      return toNodeResult(normalized);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(errOutput);
    }
  }

  private async executeIfNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    // Resolve parameters (with deep reference resolution if provided)
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    // If a conditions array is provided, use it with logicalOp
    const conditions = resolvedParams.conditions;
    const logicalOp: "AND" | "OR" =
      (resolvedParams.logicalOp || "AND").toUpperCase() === "OR" ? "OR" : "AND";

    let result: boolean;

    if (Array.isArray(conditions)) {
      // Evaluate each condition object
      const evals = conditions.map((cond: any) => {
        const { left, operator, right } = cond;
        const r = this.evaluateCondition(left, right, operator);
        return { left, operator, right, result: r };
      });

      // Aggregate based on logicalOp
      result =
        logicalOp === "OR"
          ? evals.some((e) => e.result)
          : evals.every((e) => e.result);

      // Return in Python-style shape
      return {
        success: true,
        data: {
          true: result,
          false: !result,
        },
      };
    }

    // Otherwise fallback to single comparison or direct condition
    const condition = resolvedParams.condition;
    const value1 = resolvedParams.value1;
    const value2 = resolvedParams.value2;
    const operation = resolvedParams.operation || "==";

    console.log("🔀 If node condition check:", {
      condition,
      value1,
      value2,
      operation,
    });

    if (condition !== undefined) {
      result = Boolean(condition);
    } else {
      result = this.evaluateCondition(value1, value2, operation);
    }

    return {
      success: true,
      data: {
        true: result,
        false: !result,
      },
    };
  }

  private async executeSwitchNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const cases = Array.isArray(resolvedParams.cases)
      ? resolvedParams.cases
      : [];
    const defaultCase = resolvedParams.defaultCase || "fallback";

    console.log("🔀 Switch node evaluation:", {
      cases,
      defaultCase,
    });

    const baseInput = resolvedParams.inputValue ?? resolvedParams.value;

    const switchCases = cases
      .filter((c: any) => c && (c.left !== undefined || baseInput !== undefined))
      .map((c: any, idx: number) => ({
        condition: {
          left: c.left ?? baseInput,
          operator: c.operator || "===",
          right: c.right ?? c.caseValue,
        },
        value:
          c.outputName || c.caseName || c.caseValue || `case${idx + 1}`,
      }));

    const result = await ComparatorService.executeSwitch(
      switchCases,
      defaultCase
    );

    console.log("🔀 Switch node result:", {
      matchedCase: result.matchedCase,
      selectedBranch: result.result,
      isDefault: result.matchedCase === undefined,
    });

    return {
      success: result.success,
      data: result.result,
      error: result.error,
    };
  }

  private async executeFieldNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const fields = Array.isArray(resolvedParams.fields)
      ? resolvedParams.fields
      : [];
    const persistent = !!resolvedParams.persistent;
    let result: Record<string, any> = {};

    console.log("📝 Field node processing:", {
      fields,
      inputData: input,
      hasPersistentContext: !!context?.getPersistentValue,
    });

    // Process each field operation
    for (const field of fields) {
      const { left: fieldName, operator, right: value } = field;

      if (!fieldName) {
        continue; // Skip empty field names
      }

      switch (operator) {
        case "set":
          if (
            persistent &&
            context?.getPersistentValue &&
            context?.setPersistentValue
          ) {
            // Handle persistent field - get current value or use new value
            const currentPersistentValue =
              context.getPersistentValue(fieldName);
            const finalValue =
              currentPersistentValue !== undefined
                ? currentPersistentValue
                : value;

            // Set the persistent value and save to DB
            if (currentPersistentValue !== finalValue) {
              await context.setPersistentValue(fieldName, finalValue); // Save only if changed
            }
            // Also set in result for immediate use in current execution
            result[fieldName] = finalValue;

            console.log(`💾 Persistent field ${fieldName} set to:`, finalValue);
          } else {
            // Regular non-persistent field
            result[fieldName] = value;
          }
          break;

        case "copy":
          // Copy value from another field
          if (value && result[value] !== undefined) {
            if (persistent && context?.setPersistentValue) {
              await context.setPersistentValue(fieldName, result[value]);
              console.log(
                `💾 Persistent field ${fieldName} copied value:`,
                result[value]
              );
            }
            result[fieldName] = result[value];
          }
          break;

        case "remove":
          // Remove the field
          if (persistent && context?.setPersistentValue) {
            await context.setPersistentValue(fieldName, undefined);
            console.log(`💾 Persistent field ${fieldName} removed`);
          }
          delete result[fieldName];
          break;

        default:
          console.warn(`Unknown field operator: ${operator}`);
      }
    }

    return {
      success: true,
      data: result,
    };
  }

  private async executeComputeNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const { value, operator, arg1, arg2, filterOperator, unit, date2, timezone, inputFormat, targetDay } = resolvedParams;
    const result = ComputeService.compute({ 
      value, 
      operator, 
      arg1, 
      arg2, 
      filterOperator,
      unit,
      date2,
      timezone,
      inputFormat,
      targetDay
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return result;
  }

  private async executeLoopNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    // Get loop configuration
    const inputArray = resolvedParams.inputArray || "items";
    const batchSize = Number(resolvedParams.batchSize) || 1;
    const parallel = !!resolvedParams.parallel;
    const continueOnError = !!resolvedParams.continueOnError;
    const throttleMs = Number(resolvedParams.throttleMs) || 200;
    const maxConcurrency = Number(resolvedParams.maxConcurrency) || 10;

    // If parallel=true and we have required context, delegate to LoopExecutorV2 for BullMQ distributed execution
    if (
      parallel &&
      context?.runId &&
      context?.workflowId &&
      context?.userId &&
      context?.nodes &&
      context?.edges
    ) {
      console.log(
        `🚀 [LOOP] Node ${node.id}: Delegating to LoopExecutorV2 for parallel BullMQ execution`
      );

      const loopExecutorV2 = new LoopExecutorV2();

      // Parse items first for LoopExecutorV2
      let items = resolvedParams?.inputArray || [];
      try {
        if (typeof items === "string") {
          const parsed = JSON.parse(items);
          items = Array.isArray(parsed) ? parsed : [parsed];
        } else if (!Array.isArray(items)) {
          items = items ? [items] : [];
        }
      } catch (e) {
        items = Array.isArray(items) ? items : [items];
      }

      // Convert items to Item[] format expected by LoopExecutorV2
      const itemsAsInput = Array.isArray(items)
        ? items.map((i: any) => ({ json: i }))
        : [];

      const v2Result = await loopExecutorV2.execute(
        node,
        {
          ...resolvedParams,
          items,
          batchSize,
          parallel,
          continueOnError,
          throttleMs,
          maxConcurrency,
        },
        itemsAsInput,
        context
      );

      // Convert v2 output format to NodeResult format
      return {
        success: true,
        data: v2Result.output,
        control: v2Result.control,
        meta: v2Result.meta,
      };
    }

    // Extract array items from input
    let items = resolvedParams?.inputArray || [];
    // Parse items if it's a JSON string
    try {
      if (typeof items === "string") {
        const parsed = JSON.parse(items);
        items = Array.isArray(parsed) ? parsed : [parsed];
      } else if (!Array.isArray(items)) {
        items = items ? [items] : [];
      }
    } catch (e) {
      console.warn(
        `⚠️ [BACKEND] Failed to parse loop items, using as-is:`,
        items
      );
      items = Array.isArray(items) ? items : [items];
    }

    if (!Array.isArray(items) || items.length === 0) {
      return {
        success: false,
        error: `No array found for field: ${inputArray} or array is empty`,
      };
    }

    // Get current loop state from context
    const currentIndex = context?.getState("currentIndex") || 0;
    const aggregatedResults = context?.getState("aggregatedResults") || [];
    const isCompleted = context?.getState("isCompleted") || false;

    console.log(`🔄 [LOOP] Node ${node.id} processing:`, {
      currentIndex,
      totalItems: items.length,
      batchSize,
      isCompleted,
      aggregatedCount: aggregatedResults.length,
    });

    // If loop is completed, return final aggregated results
    if (isCompleted) {
      console.log(
        `✅ [LOOP] Node ${node.id} completed with ${aggregatedResults.length} results`
      );
      // Clear loop state
      context?.setState("currentIndex", undefined);
      context?.setState("aggregatedResults", undefined);
      context?.setState("isCompleted", undefined);

      return {
        success: true,
        data: aggregatedResults,
        control: {
          loopCompleted: true,
          sourceHandle: "done",
        },
      };
    }

    // Get current batch
    const currentBatch = items.slice(currentIndex, currentIndex + batchSize);
    const nextIndex = currentIndex + currentBatch.length;
    const isLastBatch = nextIndex >= items.length;

    console.log(`🔄 [LOOP] Node ${node.id} processing batch:`, {
      batchStart: currentIndex,
      batchEnd: nextIndex - 1,
      batchSize: currentBatch.length,
      isLastBatch,
    });

    // Update loop state for next iteration
    context?.setState("currentIndex", nextIndex);

    // If this is the last batch, mark as completed for next execution
    if (isLastBatch) {
      context?.setState("isCompleted", true);
    }

    // Return current batch for loop body execution
    return {
      success: true,
      data: currentBatch.length === 1 ? currentBatch[0] : currentBatch,
      control: {
        loopIteration: true,
        sourceHandle: "loop",
        currentIndex,
        isLastBatch,
      },
    };
  }

  private evaluateCondition(
    value1: any,
    value2: any,
    operation: string
  ): boolean {
    switch (operation) {
      case "===":
        return value1 === value2;
      case "!=":
        return value1 != value2;
      case "!==":
        return value1 !== value2;
      case ">":
        return Number(value1) > Number(value2);
      case ">=":
        return Number(value1) >= Number(value2);
      case "<":
        return Number(value1) < Number(value2);
      case "<=":
        return Number(value1) <= Number(value2);
      case "contains":
        return String(value1).includes(String(value2));
      case "startsWith":
        return String(value1).startsWith(String(value2));
      case "endsWith":
        return String(value1).endsWith(String(value2));
      default:
        return Boolean(value1);
    }
  }
}
