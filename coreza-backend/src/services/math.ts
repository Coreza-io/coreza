/**
 * Math Service for Workflow Calculations
 * 
 * Provides basic arithmetic operations for workflow nodes with robust error handling
 * Supports: addition, subtraction, multiplication, and division
 * 
 * @module MathService
 */

import { createError } from '../middleware/errorHandler';

/**
 * Input parameters for mathematical operations
 */
export interface MathInput {
  left: any;      // Left operand (number or array for stats)
  operator: string; // Operation: 'add', 'subtract', 'multiply', 'divide', 'avg', 'sum', 'min', 'max', 'count', 'median', 'std'
  right?: any;    // Right operand (optional, only for binary ops)
}

/**
 * Result of a mathematical operation
 */
export interface MathResult {
  success: boolean;  // Whether the operation succeeded
  result?: number;   // Computed result (if successful)
  error?: string;    // Error message (if failed)
}

/**
 * Service class providing arithmetic operations for workflow nodes
 */
export class MathService {
  /**
   * Parse input into numeric array
   * Handles: JSON strings, arrays, comma-separated strings, single numbers
   */
  private static parseToArray(input: any): number[] {
    // Already an array
    if (Array.isArray(input)) {
      return input.map(v => Number(v)).filter(n => Number.isFinite(n));
    }
    
    // Try parsing as JSON (from slice syntax)
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        if (Array.isArray(parsed)) {
          return parsed.map(v => Number(v)).filter(n => Number.isFinite(n));
        }
      } catch {
        // Not JSON, try comma-separated
        const parts = input.split(',').map(s => Number(s.trim()));
        if (parts.every(n => Number.isFinite(n))) {
          return parts;
        }
      }
    }
    
    // Single number
    const num = Number(input);
    if (Number.isFinite(num)) {
      return [num];
    }
    
    return [];
  }

  /**
   * Calculate average of array
   */
  private static calculateAverage(values: number[]): number {
    if (values.length === 0) throw createError('Cannot calculate average of empty array', 400);
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate sum of array
   */
  private static calculateSum(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0);
  }

  /**
   * Find minimum value
   */
  private static calculateMin(values: number[]): number {
    if (values.length === 0) throw createError('Cannot find min of empty array', 400);
    return Math.min(...values);
  }

  /**
   * Find maximum value
   */
  private static calculateMax(values: number[]): number {
    if (values.length === 0) throw createError('Cannot find max of empty array', 400);
    return Math.max(...values);
  }

  /**
   * Calculate median (middle value)
   */
  private static calculateMedian(values: number[]): number {
    if (values.length === 0) throw createError('Cannot calculate median of empty array', 400);
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Calculate standard deviation
   */
  private static calculateStd(values: number[]): number {
    if (values.length === 0) throw createError('Cannot calculate std of empty array', 400);
    const avg = this.calculateAverage(values);
    const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Performs arithmetic calculation on two operands or statistical operation on array
   * 
   * @param input - Math operation parameters
   * @returns Result object with success status and computed value or error
   * 
   * @example
   * ```typescript
   * // Binary operation
   * const result = MathService.calculate({ left: 10, operator: 'add', right: 5 });
   * console.log(result); // { success: true, result: 15 }
   * 
   * // Statistical operation
   * const result = MathService.calculate({ left: [10, 20, 30], operator: 'avg' });
   * console.log(result); // { success: true, result: 20 }
   * ```
   */
  static calculate(input: MathInput): MathResult {
    try {
      const operator = input.operator;
      
      // Determine if this is a statistical operation
      const statOps = ['avg', 'sum', 'min', 'max', 'count', 'median', 'std'];
      const isStatOp = statOps.includes(operator);
      
      if (isStatOp) {
        // Statistical operation on array
        const values = this.parseToArray(input.left);
        
        if (values.length === 0) {
          throw createError('No valid numeric values provided', 400);
        }
        
        console.log(`[MathService] ${operator} on array of ${values.length} values`);
        
        let result: number;
        switch (operator) {
          case 'avg':
            result = this.calculateAverage(values);
            break;
          case 'sum':
            result = this.calculateSum(values);
            break;
          case 'min':
            result = this.calculateMin(values);
            break;
          case 'max':
            result = this.calculateMax(values);
            break;
          case 'count':
            result = values.length;
            break;
          case 'median':
            result = this.calculateMedian(values);
            break;
          case 'std':
            result = this.calculateStd(values);
            break;
          default:
            throw createError(`Unsupported statistical operator: ${operator}`, 400);
        }
        
        console.log(`[MathService] ${operator} result: ${result}`);
        return { success: true, result };
      } else {
        // Binary operation (existing code)
        const left = Number(input.left);
        const right = Number(input.right);
        
        // Validate numeric inputs
        if (!Number.isFinite(left) || !Number.isFinite(right)) {
          console.error(`[MathService] Invalid numeric input: left=${input.left}, right=${input.right}`);
          throw createError('left and right must be numeric for binary operations', 400);
        }
        
        console.log(`[MathService] Calculating: ${left} ${operator} ${right}`);
        
        let result: number;
        switch (operator) {
          case 'add':
            result = left + right;
            break;
          case 'subtract':
            result = left - right;
            break;
          case 'multiply':
            result = left * right;
            break;
          case 'divide':
            if (right === 0) {
              console.error('[MathService] Division by zero attempted');
              throw createError('Cannot divide by zero', 400);
            }
            result = left / right;
            break;
          default:
            console.error(`[MathService] Unsupported operator: ${operator}`);
            throw createError(`Unsupported operator: ${operator}`, 400);
        }
        
        console.log(`[MathService] Calculation result: ${result}`);
        return { success: true, result };
      }
    } catch (err: any) {
      console.error(`[MathService] Calculation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
