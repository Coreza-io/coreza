import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';

export class ControlFlowExecutor implements INodeExecutor {
  readonly category = 'ControlFlow';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      
      switch (nodeType) {
        case 'If':
          return this.executeIfNode(node, input, context);
        case 'Switch':
          return this.executeSwitchNode(node, input, context);
        default:
          return {
            success: false,
            error: `Unsupported control flow node type: ${nodeType}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Control flow execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async executeIfNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters ? 
      context.resolveNodeParameters(node, input) : 
      { ...node.values, ...input };

    const condition = resolvedParams.condition;
    const value1 = resolvedParams.value1;
    const value2 = resolvedParams.value2;
    const operation = resolvedParams.operation || '==';

    console.log('🔀 If node condition check:', { condition, value1, value2, operation });

    let result: boolean;
    
    if (condition !== undefined) {
      result = Boolean(condition);
    } else {
      result = this.evaluateCondition(value1, value2, operation);
    }

    return {
      success: true,
      data: {
        result,
        condition: result,
        branch: result ? 'true' : 'false',
        evaluation: { value1, value2, operation, result }
      }
    };
  }

  private async executeSwitchNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters ? 
      context.resolveNodeParameters(node, input) : 
      { ...node.values, ...input };

    const value = resolvedParams.value;
    const cases = resolvedParams.cases || [];
    const defaultCase = resolvedParams.defaultCase;

    console.log('🔀 Switch node evaluation:', { value, cases, defaultCase });

    // Find matching case
    const matchedCase = cases.find((c: any) => c.value === value);
    const selectedCase = matchedCase || defaultCase;

    return {
      success: true,
      data: {
        value,
        matchedCase: matchedCase?.value,
        selectedBranch: selectedCase,
        hasMatch: !!matchedCase
      }
    };
  }

  private evaluateCondition(value1: any, value2: any, operation: string): boolean {
    switch (operation) {
      case '==':
      case 'equals':
        return value1 == value2;
      case '===':
      case 'strictEquals':
        return value1 === value2;
      case '!=':
      case 'notEquals':
        return value1 != value2;
      case '!==':
      case 'strictNotEquals':
        return value1 !== value2;
      case '>':
      case 'greaterThan':
        return Number(value1) > Number(value2);
      case '>=':
      case 'greaterThanOrEqual':
        return Number(value1) >= Number(value2);
      case '<':
      case 'lessThan':
        return Number(value1) < Number(value2);
      case '<=':
      case 'lessThanOrEqual':
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