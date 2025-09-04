import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { MathService } from "../../services/math";
import { TransformService } from "../../services/transform";

export class ControlFlowExecutor implements INodeExecutor {
  readonly category = "ControlFlow";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      switch (nodeType) {
        case "If":
          return this.executeIfNode(node, input, context);
        case "Switch":
          return this.executeSwitchNode(node, input, context);
        case "Edit Fields":
          return this.executeFieldNode(node, input, context);
        case "Math":
          return this.executeMathNode(node, input, context);
        case "Transform":
          return this.executeTransformNode(node, input, context);
        case "Loop":
          return this.executeLoopNode(node, input, context);
        default:
          return {
            success: false,
            error: `Unsupported control flow node type: ${nodeType}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Control flow execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
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

    const inputValue = resolvedParams.inputValue || resolvedParams.value;
    const cases = Array.isArray(resolvedParams.cases)
      ? resolvedParams.cases
      : [];
    const defaultCase = resolvedParams.defaultCase || "default";

    console.log("🔀 Switch node evaluation:", {
      inputValue,
      cases,
      defaultCase,
      originalInput: input,
    });

    // Find matching case by caseValue (not value)
    const matchedCase = cases.find((c: any) => c.caseValue === inputValue);
    const selectedBranch = matchedCase ? matchedCase.caseValue : defaultCase;

    console.log("🔀 Switch node result:", {
      matchedCase: matchedCase?.caseValue,
      selectedBranch,
      isDefault: !matchedCase,
    });

    // Return the selected branch name as a simple string for routing
    // The workflow executor will use this to determine which edge to take
    return {
      success: true,
      data: selectedBranch,
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

    const fields = Array.isArray(resolvedParams.conditions)
      ? resolvedParams.conditions
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

  private async executeMathNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const { left, operator, right } = resolvedParams;
    const result = MathService.calculate({ left, operator, right });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: { result: result.result } };
  }

  private async executeTransformNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const { value, operator, arg1, arg2 } = resolvedParams;
    const result = TransformService.transform({ value, operator, arg1, arg2 });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, data: { result: result.result } };
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

      const result: any = {
        success: true,
        data: aggregatedResults,
      };

      // Add metadata for WorkflowEngine routing
      result.meta = {
        sourceHandle: "done",
        isLoopCompleted: true,
      };

      return result;
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
    const result: any = {
      success: true,
      data: currentBatch.length === 1 ? currentBatch[0] : currentBatch,
    };

    // Add metadata for WorkflowEngine routing
    result.meta = {
      sourceHandle: "loop",
      isLoopIteration: true,
      currentIndex,
      isLastBatch,
      loopConfig: { batchSize, parallel, continueOnError, throttleMs },
    };

    return result;
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
