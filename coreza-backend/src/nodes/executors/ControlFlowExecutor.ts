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
import { ComputeService } from "../../nodes/logic/compute";
import { LoopExecutorV2 } from "./LoopExecutorV2";
import { ComparatorService } from "../../nodes/logic/comparator";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  leanSuccess,
  leanError,
} from "../../utils/normalizeOutput";

export class ControlFlowExecutor implements INodeExecutor {
  private isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
      !!value && typeof (value as PromiseLike<unknown>).then === "function"
    );
  }

  readonly category = "ControlFlow";
  readonly syncCapable = true;

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    try {
      const nodeName = node.name;
      switch (nodeName) {
        case "If":
          return this.executeIfNode(node, input, context);
        case "Switch":
          return this.executeSwitchNode(node, input, context);
        case "Edit Fields":
          return this.executeFieldNode(node, input, context);
        case "Compute":
          return this.executeComputeNode(node, input, context);
        case "Loop":
          return this.executeLoopNode(node, input, context);
        default:
          return toNodeResult(
            createErrorOutput(
              `Unsupported control flow node type: ${nodeName}`,
            ),
          );
      }
    } catch (error) {
      return toNodeResult(createErrorOutput(error));
    }
  }

  private executeIfNode(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const conditions = Array.isArray(resolvedParams.conditions)
      ? resolvedParams.conditions
      : [];

    const logicalOp: "AND" | "OR" =
      String(resolvedParams.logicalOp || "AND").toUpperCase() === "OR"
        ? "OR"
        : "AND";

    if (conditions.length === 0) {
      return leanError("If node requires at least one condition");
    }

    const target = logicalOp === "OR";

    for (const cond of conditions) {
      if (!cond || !cond.operator) {
        return leanError("Invalid If condition");
      }

      const evalResult = ComparatorService.evaluate({
        left: cond.left,
        operator: cond.operator,
        right: cond.right,
        dataType: cond.dataType,
      });

      if (!evalResult.success) {
        return leanError(evalResult.error || "If condition evaluation failed");
      }

      const matched = Boolean(evalResult.data);

      // OR: stop on true
      // AND: stop on false
      if (matched === target) {
        return leanSuccess({
          true: target,
          false: !target,
        });
      }
    }

    return leanSuccess({
      true: !target,
      false: target,
    });
  }

  private executeSwitchNode(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const cases = Array.isArray(resolvedParams.cases)
      ? resolvedParams.cases
      : [];
    const defaultCase = resolvedParams.defaultCase || "fallback";

    const baseInput = resolvedParams.inputValue ?? resolvedParams.value;

    const switchCases = cases
      .filter(
        (c: any) => c && (c.left !== undefined || baseInput !== undefined),
      )
      .map((c: any, idx: number) => ({
        condition: {
          left: c.left ?? baseInput,
          operator: c.operator || "===",
          right: c.right ?? c.caseValue,
          dataType: c.dataType, // Add dataType support for proper type handling
        },
        value: c.outputName || c.caseName || c.caseValue || `case${idx + 1}`,
      }));

    const result = ComparatorService.executeSwitch(switchCases, defaultCase);

    if (!result.success) {
      return leanError(result.error || "Switch evaluation failed");
    }

    const switchResult =
      result.data && typeof result.data === "object" && "result" in result.data
        ? result.data.result
        : result.data;

    return leanSuccess(switchResult);
  }

  private executeFieldNode(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const fields = Array.isArray(resolvedParams.fields)
      ? resolvedParams.fields
      : [];
    const persistent = !!resolvedParams.persistent;
    let result: Record<string, any> = {};

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
              const persistResult = context.setPersistentValue(
                fieldName,
                finalValue,
              ); // Save only if changed
              if (this.isPromiseLike(persistResult)) {
                return leanError(
                  "Edit Fields persistent operations require async execution",
                );
              }
            }
            // Also set in result for immediate use in current execution
            result[fieldName] = finalValue;
          } else {
            // Regular non-persistent field
            result[fieldName] = value;
          }
          break;

        case "copy":
          // Copy value from another field
          if (value && result[value] !== undefined) {
            if (persistent && context?.setPersistentValue) {
              const persistResult = context.setPersistentValue(
                fieldName,
                result[value],
              );
              if (this.isPromiseLike(persistResult)) {
                return leanError(
                  "Edit Fields persistent operations require async execution",
                );
              }
            }
            result[fieldName] = result[value];
          }
          break;

        case "remove":
          // Remove the field
          if (persistent && context?.setPersistentValue) {
            const persistResult = context.setPersistentValue(
              fieldName,
              undefined,
            );
            if (this.isPromiseLike(persistResult)) {
              return leanError(
                "Edit Fields persistent operations require async execution",
              );
            }
          }
          delete result[fieldName];
          break;

        default:
          break;
      }
    }

    return leanSuccess(result);
  }

  private executeComputeNode(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): NodeResult {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const result = ComputeService.compute(resolvedParams);

    return result.success
      ? leanSuccess(result.data)
      : leanError(result.error || "Compute operation failed");
  }

  private async executeLoopNode(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
  ): Promise<NodeResult> {
    const currentIndex = context?.getState("currentIndex") || 0;
    const cachedItems = context?.getState("_loopItems");
    const cachedConfig = context?.getState("_loopConfig");

    if (
      currentIndex > 0 &&
      Array.isArray(cachedItems) &&
      cachedConfig &&
      typeof cachedConfig === "object"
    ) {
      const aggregatedResults = context?.getState("aggregatedResults") || [];
      const isCompleted = context?.getState("isCompleted") || false;

      if (isCompleted) {
        context?.setState("currentIndex", undefined);
        context?.setState("aggregatedResults", undefined);
        context?.setState("isCompleted", undefined);
        context?.setState("_loopItems", undefined);
        context?.setState("_loopConfig", undefined);

        return {
          success: true,
          data: aggregatedResults,
          control: {
            loopCompleted: true,
            sourceHandle: "done",
          },
        };
      }

      const batchSize = Number(cachedConfig.batchSize) || 1;
      const currentBatch = cachedItems.slice(
        currentIndex,
        currentIndex + batchSize,
      );
      const nextIndex = currentIndex + currentBatch.length;
      const isLastBatch = nextIndex >= cachedItems.length;

      context?.setState("currentIndex", nextIndex);
      if (isLastBatch) {
        context?.setState("isCompleted", true);
      }

      const loopData =
        currentBatch.length === 1 ? [currentBatch[0]] : currentBatch;

      return {
        success: true,
        data: {
          Item: loopData,
          totalItem: cachedItems.length,
          CurrentIndex: currentIndex,
          isLastBatch: isLastBatch,
        },
        control: {
          loopIteration: true,
          sourceHandle: "loop",
          currentIndex,
          isLastBatch: isLastBatch,
        },
      };
    }

    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    // Get loop configuration
    const inputArray = resolvedParams.inputArray || "items";
    const batchSize = Number(resolvedParams.batchSize) || 1;
    const parallel = !!resolvedParams.parallel;
    const continueOnError = !!resolvedParams.continueOnError;
    const isBacktest = context?.executionMode === "backtest";
    const throttleMs = isBacktest
      ? 0
      : Number(resolvedParams.throttleMs) || 200;
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
        context,
      );

      // Convert v2 output format to NodeResult format with standardized output
      const parallelCurrentIndex = v2Result.control?.currentIndex ?? 0;
      const parallelItems = Array.isArray(v2Result.output)
        ? v2Result.output
        : v2Result.output == null
          ? []
          : [v2Result.output];

      return {
        success: true,
        data: {
          Item: parallelItems,
          totalItem: items.length,
          CurrentIndex: parallelCurrentIndex,
          isLastBatch: Boolean(v2Result.control?.isLastBatch),
        },
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
      items = Array.isArray(items) ? items : [items];
    }

    if (!Array.isArray(items) || items.length === 0) {
      return toNodeResult(
        createErrorOutput(
          `No array found for field: ${inputArray} or array is empty`,
        ),
      );
    }

    // Cache parsed loop items/config for re-entry fast path
    context?.setState("_loopItems", items);
    context?.setState("_loopConfig", {
      batchSize,
      parallel,
      continueOnError,
      throttleMs,
    });

    // Get current loop state from context
    const currentIndexFromState = context?.getState("currentIndex") || 0;
    const aggregatedResults = context?.getState("aggregatedResults") || [];
    const isCompleted = context?.getState("isCompleted") || false;

    // If loop is completed, return final aggregated results
    if (isCompleted) {
      // Clear loop state
      context?.setState("currentIndex", undefined);
      context?.setState("aggregatedResults", undefined);
      context?.setState("isCompleted", undefined);
      context?.setState("_loopItems", undefined);
      context?.setState("_loopConfig", undefined);

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
    const currentBatch = items.slice(
      currentIndexFromState,
      currentIndexFromState + batchSize,
    );
    const nextIndex = currentIndexFromState + currentBatch.length;
    const isLastBatch = nextIndex >= items.length;

    // Update loop state for next iteration
    context?.setState("currentIndex", nextIndex);

    // If this is the last batch, mark as completed for next execution
    if (isLastBatch) {
      context?.setState("isCompleted", true);
    }

    // Return current batch for loop body execution
    const loopData =
      currentBatch.length === 1 ? [currentBatch[0]] : currentBatch;

    return {
      success: true,
      data: {
        Item: loopData,
        totalItem: items.length,
        CurrentIndex: currentIndexFromState,
        isLastBatch: isLastBatch,
      },
      control: {
        loopIteration: true,
        sourceHandle: "loop",
        currentIndex: currentIndexFromState,
        isLastBatch,
      },
    };
  }
}
