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
        case 'len': {
          // If already an array
          if (Array.isArray(value)) {
            return { success: true, result: value.length };
          }

          // If object (non-null)
          if (typeof value === 'object' && value !== null) {
            return { success: true, result: Object.keys(value).length };
          }

          // If string: try to parse JSON and then compute length appropriately
          if (typeof value === 'string') {
            // Quick heuristic: only attempt JSON parse if it *looks* like JSON
            const looksLikeJson = /^\s*[\[{]/.test(value);
            if (looksLikeJson) {
              try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                  return { success: true, result: parsed.length };
                }
                if (parsed && typeof parsed === 'object') {
                  return { success: true, result: Object.keys(parsed).length };
                }
                // Primitive JSON (string/number/bool/null) → fall back to string length
              } catch {
                // Not valid JSON → fall through to string length
              }
            }
            // Default: character count of the string
            return { success: true, result: value.length };
          }

          // Fallback for numbers/booleans/etc: length of their string representation
          return { success: true, result: String(value).length };
        }

        case 'substring': {
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
                : value.substring(start),
          };
        }

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
