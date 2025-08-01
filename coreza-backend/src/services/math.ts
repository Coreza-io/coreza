import { createError } from '../middleware/errorHandler';

export interface MathInput {
  left: any;
  operator: string;
  right: any;
}

export interface MathResult {
  success: boolean;
  result?: number;
  error?: string;
}

export class MathService {
  static calculate(input: MathInput): MathResult {
    try {
      const left = Number(input.left);
      const right = Number(input.right);
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        throw createError('left and right must be numeric', 400);
      }
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
            throw createError('Cannot divide by zero', 400);
          }
          result = left / right;
          break;
        default:
          throw createError(`Unsupported operator: ${input.operator}`, 400);
      }
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
