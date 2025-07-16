import { Node, Edge } from '@xyflow/react';
import { Condition, LogicNodeResult, IfNodeData, SwitchNodeData } from '@/types/logicTypes';
import { resolveReferences } from './resolveReferences';

/**
 * Core logic engine for evaluating workflow logic nodes
 */
export class LogicEngine {
  
  /**
   * Resolve a value that might contain node references
   */
  static resolveValue(value: string, inputData: any): any {
    if (typeof value !== 'string' || !value.includes('{{')) {
      return value;
    }

    // Handle node references like {{ $('NodeName').json.field }}
    const nodeRefMatch = value.match(/\{\{\s*\$\('([^']+)'\)\.json\.(.+?)\s*\}\}/);
    if (nodeRefMatch) {
      const [, nodeName, fieldPath] = nodeRefMatch;
      console.log(`Resolving node reference: ${nodeName}.${fieldPath}`);
      console.log('Available input data:', inputData);
      
      // Find the node data by looking for nodes with matching type or name
      const nodeData = inputData[nodeName] || Object.values(inputData).find((data: any) => 
        data && typeof data === 'object' && data.type === nodeName
      );
      
      if (!nodeData) {
        console.warn(`Node ${nodeName} not found in input data`);
        return value; // Return original if not found
      }

      // Navigate the field path
      const fieldParts = fieldPath.split('.');
      let result = nodeData;
      
      for (const part of fieldParts) {
        if (result && typeof result === 'object' && part in result) {
          result = result[part];
        } else {
          console.warn(`Field ${fieldPath} not found in node ${nodeName} data`);
          return value; // Return original if field not found
        }
      }
      
      console.log(`Resolved ${nodeName}.${fieldPath} to:`, result);
      return result;
    }

    // Fallback to original resolveReferences for other formats
    return resolveReferences(value, inputData);
  }

  /**
   * Evaluate a single condition
   */
  static evaluateCondition(condition: Condition, inputData: any): boolean {
    // Handle node reference resolution properly
    const leftValue = this.resolveValue(condition.left, inputData);
    const rightValue = this.resolveValue(condition.right, inputData);
    
    console.log(`Evaluating condition: ${leftValue} ${condition.operator} ${rightValue}`);
    
    return this.compareValues(leftValue, rightValue, condition.operator);
  }

  /**
   * Evaluate multiple conditions with AND/OR logic
   */
  static evaluateConditions(conditions: Condition[], operator: 'AND' | 'OR', inputData: any): boolean {
    if (!conditions || conditions.length === 0) return false;
    
    const results = conditions.map(condition => this.evaluateCondition(condition, inputData));
    
    if (operator === 'AND') {
      return results.every(result => result);
    } else {
      return results.some(result => result);
    }
  }

  /**
   * Compare two values based on the operator
   */
  static compareValues(left: any, right: any, operator: string): boolean {
    // Convert values to appropriate types for comparison
    const leftVal = this.convertValue(left);
    const rightVal = this.convertValue(right);
    
    switch (operator) {
      case '==':
      case 'equals':
        return leftVal == rightVal;
      case '===':
      case 'strict_equals':
        return leftVal === rightVal;
      case '!=':
      case 'not_equals':
        return leftVal != rightVal;
      case '!==':
      case 'strict_not_equals':
        return leftVal !== rightVal;
      case '>':
      case 'greater_than':
        return Number(leftVal) > Number(rightVal);
      case '>=':
      case 'greater_than_or_equal':
        return Number(leftVal) >= Number(rightVal);
      case '<':
      case 'less_than':
        return Number(leftVal) < Number(rightVal);
      case '<=':
      case 'less_than_or_equal':
        return Number(leftVal) <= Number(rightVal);
      case 'contains':
        return String(leftVal).includes(String(rightVal));
      case 'starts_with':
        return String(leftVal).startsWith(String(rightVal));
      case 'ends_with':
        return String(leftVal).endsWith(String(rightVal));
      case 'is_empty':
        return !leftVal || leftVal === '' || leftVal === null || leftVal === undefined;
      case 'is_not_empty':
        return leftVal && leftVal !== '' && leftVal !== null && leftVal !== undefined;
      default:
        console.warn(`Unknown operator: ${operator}`);
        return false;
    }
  }

  /**
   * Convert string values to appropriate types
   */
  static convertValue(value: any): any {
    if (typeof value === 'string') {
      // Try to parse as number
      if (!isNaN(Number(value)) && value.trim() !== '') {
        return Number(value);
      }
      // Try to parse as boolean
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
      // Try to parse as null
      if (value.toLowerCase() === 'null') return null;
    }
    return value;
  }

  /**
   * Evaluate an If node
   */
  static evaluateIfNode(node: Node, inputData: any, outgoingEdges: Edge[]): LogicNodeResult {
    try {
      const nodeData = node.data as unknown as IfNodeData;
      
      if (!nodeData.conditions || nodeData.conditions.length === 0) {
        return {
          success: false,
          error: 'No conditions defined for If node'
        };
      }

      const conditionResult = this.evaluateConditions(
        nodeData.conditions, 
        nodeData.operator || 'AND', 
        inputData
      );

      // Find the appropriate outgoing edge
      const trueEdge = outgoingEdges.find(edge => 
        edge.sourceHandle === 'true' || edge.label === 'true' || !edge.sourceHandle
      );
      const falseEdge = outgoingEdges.find(edge => 
        edge.sourceHandle === 'false' || edge.label === 'false'
      );

      const targetEdge = conditionResult ? trueEdge : falseEdge;

      console.log(`If node evaluation result: ${conditionResult}, targeting edge: ${targetEdge?.id}`);

      return {
        success: true,
        outputEdgeId: targetEdge?.id
      };

    } catch (error) {
      console.error("Error in evaluateIfNode:", error);
      return {
        success: false,
        error: `Error evaluating If node: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Evaluate a Switch node
   */
  static evaluateSwitchNode(node: Node, inputData: any, outgoingEdges: Edge[]): LogicNodeResult {
    try {
      const nodeData = node.data as unknown as SwitchNodeData;
      
      if (!nodeData.variable) {
        return {
          success: false,
          error: 'No variable defined for Switch node'
        };
      }

      const variableValue = resolveReferences(nodeData.variable, inputData);
      
      // Find matching case
      const matchingCase = nodeData.cases?.find(caseItem => 
        this.compareValues(variableValue, caseItem.value, '==')
      );

      let targetEdgeId: string | undefined;

      if (matchingCase) {
        // Find edge by case ID or handle
        const targetEdge = outgoingEdges.find(edge => 
          edge.id === matchingCase.edgeId || edge.sourceHandle === matchingCase.edgeId
        );
        targetEdgeId = targetEdge?.id;
      } else if (nodeData.defaultEdgeId) {
        // Use default case
        const defaultEdge = outgoingEdges.find(edge => 
          edge.id === nodeData.defaultEdgeId || edge.sourceHandle === 'default'
        );
        targetEdgeId = defaultEdge?.id;
      }

      return {
        success: true,
        outputEdgeId: targetEdgeId
      };

    } catch (error) {
      return {
        success: false,
        error: `Error evaluating Switch node: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Main entry point for evaluating any logic node
   */
  static evaluateLogicNode(node: Node, inputData: any, outgoingEdges: Edge[]): LogicNodeResult {
    const nodeType = node.type?.toLowerCase();

    switch (nodeType) {
      case 'if':
        return this.evaluateIfNode(node, inputData, outgoingEdges);
      case 'switch':
        return this.evaluateSwitchNode(node, inputData, outgoingEdges);
      default:
        return {
          success: false,
          error: `Unknown logic node type: ${nodeType}`
        };
    }
  }
}