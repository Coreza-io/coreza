export interface TransformInput {
  value: any;
  operator: string;
  arg1?: any;
  arg2?: any;
}

export interface TransformResult {
  success: boolean;
  result?: any;
  error?: string;
}

export class TransformService {
  static transform(input: TransformInput): TransformResult {
    try {
      const { value, operator, arg1, arg2 } = input;
      switch (operator) {
        case 'len':
          if (typeof value === 'string' || Array.isArray(value)) {
            return { success: true, result: value.length };
          }
          if (typeof value === 'object' && value !== null) {
            return { success: true, result: Object.keys(value).length };
          }
          return { success: true, result: String(value).length };
        case 'substring':
          if (typeof value !== 'string') {
            return { success: false, error: 'Value must be a string' };
          }
          const start = Number(arg1) || 0;
          const length = arg2 !== undefined ? Number(arg2) : undefined;
          return {
            success: true,
            result:
              length !== undefined
                ? value.substring(start, start + length)
                : value.substring(start)
          };
        case 'trim':
          return { success: true, result: String(value).trim() };
        case 'upper':
          return { success: true, result: String(value).toUpperCase() };
        case 'lower':
          return { success: true, result: String(value).toLowerCase() };
        default:
          return { success: false, error: `Unsupported operator: ${operator}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
