import { createError } from '../middleware/errorHandler';

export interface ComparatorInput {
  left: any;
  operator: string;
  right: any;
}

export interface ComparatorResult {
  success: boolean;
  result: boolean;
  error?: string;
}

export class ComparatorService {
  static async evaluate(input: ComparatorInput): Promise<ComparatorResult> {
    try {
      const { left, operator, right } = input;
      let result: boolean;

      switch (operator) {
        case '==':
        case 'equals':
          result = left == right;
          break;
        case '===':
        case 'strict_equals':
          result = left === right;
          break;
        case '!=':
        case 'not_equals':
          result = left != right;
          break;
        case '!==':
        case 'strict_not_equals':
          result = left !== right;
          break;
        case '>':
        case 'greater_than':
          result = Number(left) > Number(right);
          break;
        case '>=':
        case 'greater_than_or_equal':
          result = Number(left) >= Number(right);
          break;
        case '<':
        case 'less_than':
          result = Number(left) < Number(right);
          break;
        case '<=':
        case 'less_than_or_equal':
          result = Number(left) <= Number(right);
          break;
        case 'contains':
          result = String(left).toLowerCase().includes(String(right).toLowerCase());
          break;
        case 'starts_with':
          result = String(left).toLowerCase().startsWith(String(right).toLowerCase());
          break;
        case 'ends_with':
          result = String(left).toLowerCase().endsWith(String(right).toLowerCase());
          break;
        case 'regex':
          const regex = new RegExp(String(right), 'i');
          result = regex.test(String(left));
          break;
        case 'in_array':
          result = Array.isArray(right) && right.includes(left);
          break;
        case 'not_in_array':
          result = Array.isArray(right) && !right.includes(left);
          break;
        case 'is_empty':
          result = !left || left === '' || (Array.isArray(left) && left.length === 0) || (typeof left === 'object' && Object.keys(left).length === 0);
          break;
        case 'is_not_empty':
          result = !!left && left !== '' && !(Array.isArray(left) && left.length === 0) && !(typeof left === 'object' && Object.keys(left).length === 0);
          break;
        case 'isNull':
          result = left === null;
          break;
        case 'is_not_null':
          result = left !== null;
          break;
        case 'is_undefined':
          result = left === undefined;
          break;
        case 'is_not_undefined':
          result = left !== undefined;
          break;
        case 'is_number':
          result = typeof left === 'number' && !isNaN(left);
          break;
        case 'is_string':
          result = typeof left === 'string';
          break;
        case 'is_boolean':
          result = typeof left === 'boolean';
          break;
        case 'is_array':
          result = Array.isArray(left);
          break;
        case 'is_object':
          result = typeof left === 'object' && left !== null && !Array.isArray(left);
          break;
        default:
          throw createError(`Unsupported operator: ${operator}`, 400);
      }

      return { success: true, result };
    } catch (error: any) {
      return { success: false, result: false, error: error.message };
    }
  }

  static async executeIf(condition: ComparatorInput): Promise<ComparatorResult> {
    return this.evaluate(condition);
  }

  static async executeSwitch(cases: Array<{ condition: ComparatorInput; value: any }>, defaultValue?: any): Promise<{ success: boolean; result: any; matchedCase?: number; error?: string }> {
    try {
      for (let i = 0; i < cases.length; i++) {
        const caseResult = await this.evaluate(cases[i].condition);
        if (caseResult.success && caseResult.result) {
          return { 
            success: true, 
            result: cases[i].value,
            matchedCase: i
          };
        }
      }

      // No case matched, return default value
      return { 
        success: true, 
        result: defaultValue ?? null 
      };
    } catch (error: any) {
      return { 
        success: false, 
        result: null, 
        error: error.message 
      };
    }
  }
}