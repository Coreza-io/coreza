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
  left: any;      // Left operand (will be coerced to number)
  operator: string; // Operation: 'add', 'subtract', 'multiply', 'divide'
  right: any;     // Right operand (will be coerced to number)
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
   * Performs arithmetic calculation on two operands
   * 
   * @param input - Math operation parameters
   * @returns Result object with success status and computed value or error
   * 
   * @example
   * ```typescript
   * const result = MathService.calculate({ left: 10, operator: 'add', right: 5 });
   * console.log(result); // { success: true, result: 15 }
   * ```
   */
  static calculate(input: MathInput): MathResult {
    try {
      const left = Number(input.left);
      const right = Number(input.right);
      
      // Validate numeric inputs
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        console.error(`[MathService] Invalid numeric input: left=${input.left}, right=${input.right}`);
        throw createError('left and right must be numeric', 400);
      }
      
      console.log(`[MathService] Calculating: ${left} ${input.operator} ${right}`);
      
      let result: number;
      switch (input.operator) {
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
          console.error(`[MathService] Unsupported operator: ${input.operator}`);
          throw createError(`Unsupported operator: ${input.operator}`, 400);
      }
      
      console.log(`[MathService] Calculation result: ${result}`);
      return { success: true, result };
    } catch (err: any) {
      console.error(`[MathService] Calculation failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
