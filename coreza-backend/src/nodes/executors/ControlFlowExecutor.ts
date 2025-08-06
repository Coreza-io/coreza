// src/nodes/executors/ControlFlowExecutor.ts

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { MathService } from '../../services/math';
import { TransformService } from '../../services/transform';

export class ControlFlowExecutor implements INodeExecutor {
  readonly category = 'ControlFlow';

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      switch (nodeType) {
        case 'If':
          return this.executeIfNode(node, input, context);
        case 'Switch':
          return this.executeSwitchNode(node, input, context);
        case 'Edit Fields':
          return this.executeFieldNode(node, input, context);
        case 'Math':
          return this.executeMathNode(node, input, context);
        case 'Transform':
          return this.executeTransformNode(node, input, context);
        case 'Loop':
          return this.executeLoopNode(node, input, context);
        default:
          return {
            success: false,
            error: `Unsupported control flow node type: ${nodeType}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Control flow execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`
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
    const logicalOp: 'AND' | 'OR' =
      (resolvedParams.logicalOp || 'AND').toUpperCase() === 'OR'
        ? 'OR'
        : 'AND';

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
        logicalOp === 'OR'
          ? evals.some(e => e.result)
          : evals.every(e => e.result);

      // Return in Python-style shape
      return {
        success: true,
        data: {
          true: result,
          false: !result
        }
      };
    }

    // Otherwise fallback to single comparison or direct condition
    const condition = resolvedParams.condition;
    const value1 = resolvedParams.value1;
    const value2 = resolvedParams.value2;
    const operation = resolvedParams.operation || '==';

    console.log('🔀 If node condition check:', {
      condition,
      value1,
      value2,
      operation
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
        false: !result
      }
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

    const value = resolvedParams.value;
    const cases = Array.isArray(resolvedParams.cases)
      ? resolvedParams.cases
      : [];
    const defaultCase = resolvedParams.defaultCase;

    console.log('🔀 Switch node evaluation:', {
      value,
      cases,
      defaultCase
    });

    // Find matching case
    const matchedCase = cases.find((c: any) => c.value === value);
    const selectedCase = matchedCase ? matchedCase.value : defaultCase;

    return {
      success: true,
      data: {
        inputValue: value,
        matchedCase: matchedCase?.value,
        selectedBranch: selectedCase,
        isDefault: !matchedCase,
        timestamp: new Date().toISOString()
      }
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

    const fields = Array.isArray(resolvedParams.conditions) ? resolvedParams.conditions : [];
    const persistent = !!resolvedParams.persistent;
    let result: Record<string, any> = {};

    console.log('📝 Field node processing:', {
      fields,
      inputData: input,
      hasPersistentContext: !!context?.getPersistentValue
    });

    // Process each field operation
    for (const field of fields) {
      const { left: fieldName, operator, right: value } = field;

      if (!fieldName) {
        continue; // Skip empty field names
      }

      switch (operator) {
        case 'set':
          if (persistent && context?.getPersistentValue && context?.setPersistentValue) {
            // Handle persistent field - get current value or use new value
            const currentPersistentValue = context.getPersistentValue(fieldName);
            const finalValue = currentPersistentValue !== undefined ? currentPersistentValue : value;
            
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
        
        case 'copy':
          // Copy value from another field
          if (value && result[value] !== undefined) {
            if (persistent && context?.setPersistentValue) {
              await context.setPersistentValue(fieldName, result[value]);
              console.log(`💾 Persistent field ${fieldName} copied value:`, result[value]);
            }
            result[fieldName] = result[value];
          }
          break;
        
        case 'remove':
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
      data: result
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
    console.log(`🔄 [BACKEND] Loop node ${node.id} returning metadata only - actual execution handled by WorkflowEngine`);
    
    // Return simple metadata - actual loop execution is handled in WorkflowEngine
    // This matches the frontend behavior where Loop nodes just return basic item info
    const loopContext = input.loopItem || input.item || input;
    
    return {
      success: true,
      data: {
        item: loopContext
      }
    };
  }



  private evaluateCondition(
    value1: any,
    value2: any,
    operation: string
  ): boolean {
    switch (operation) {
      case '===':
        return value1 === value2;
      case '!=':
        return value1 != value2;
      case '!==':
        return value1 !== value2;
      case '>':
        return Number(value1) > Number(value2);
      case '>=':
        return Number(value1) >= Number(value2);
      case '<':
        return Number(value1) < Number(value2);
      case '<=':
        return Number(value1) <= Number(value2);
      case 'contains':
        return String(value1).includes(String(value2));
      case 'startsWith':
        return String(value1).startsWith(String(value2));
      case 'endsWith':
        return String(value1).endsWith(String(value2));
      default:
        return Boolean(value1);
    }
  }
}
