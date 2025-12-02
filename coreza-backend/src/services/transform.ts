export interface TransformInput {
  value: any;
  operator: string;
  dataType?: string;
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
        // ============== STRING OPERATIONS ==============
        case 'len': {
          if (Array.isArray(value)) {
            return { success: true, result: value.length };
          }
          if (typeof value === 'object' && value !== null) {
            return { success: true, result: Object.keys(value).length };
          }
          if (typeof value === 'string') {
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
              } catch {
                // Not valid JSON → fall through to string length
              }
            }
            return { success: true, result: value.length };
          }
          return { success: true, result: String(value).length };
        }

        case 'substring': {
          const str = String(value);
          const start = Number(arg1) || 0;
          const length = arg2 !== undefined && arg2 !== '' ? Number(arg2) : undefined;
          return {
            success: true,
            result: length !== undefined ? str.substring(start, start + length) : str.substring(start),
          };
        }

        case 'trim':
          return { success: true, result: String(value).trim() };

        case 'upper':
          return { success: true, result: String(value).toUpperCase() };

        case 'lower':
          return { success: true, result: String(value).toLowerCase() };

        case 'replace': {
          const str = String(value);
          const search = String(arg1 || '');
          const replacement = String(arg2 || '');
          return { success: true, result: str.split(search).join(replacement) };
        }

        case 'split': {
          const str = String(value);
          const delimiter = arg1 !== undefined ? String(arg1) : ',';
          return { success: true, result: str.split(delimiter) };
        }

        case 'concat': {
          const str = String(value);
          const appendStr = String(arg1 || '');
          return { success: true, result: str + appendStr };
        }

        case 'startsWith': {
          const str = String(value);
          const prefix = String(arg1 || '');
          return { success: true, result: str.startsWith(prefix) };
        }

        case 'endsWith': {
          const str = String(value);
          const suffix = String(arg1 || '');
          return { success: true, result: str.endsWith(suffix) };
        }

        case 'contains': {
          const str = String(value);
          const substring = String(arg1 || '');
          return { success: true, result: str.includes(substring) };
        }

        case 'isEmpty': {
          const str = String(value);
          return { success: true, result: str.trim().length === 0 };
        }

        case 'toJson': {
          if (typeof value !== 'string') {
            return { success: false, error: 'Value must be a string' };
          }
          // Try standard JSON parse first
          try {
            return { success: true, result: JSON.parse(value) };
          } catch {
            // Fall back to key-value parsing
          }
          
          let str = value.trim();
          if (str.startsWith('{') && str.endsWith('}')) {
            str = str.slice(1, -1).trim();
          }

          const pairs = str.split(',').map(p => p.trim()).filter(p => p);
          const result: Record<string, any> = {};

          for (const pair of pairs) {
            const colonIndex = pair.indexOf(':');
            if (colonIndex === -1) continue;

            const key = pair.substring(0, colonIndex).trim();
            let val: any = pair.substring(colonIndex + 1).trim();

            if (!isNaN(Number(val)) && val !== '') {
              val = Number(val);
            } else if (val.toLowerCase() === 'true') {
              val = true;
            } else if (val.toLowerCase() === 'false') {
              val = false;
            } else if (val.toLowerCase() === 'null') {
              val = null;
            }

            result[key] = val;
          }

          return { success: true, result };
        }

        // ============== NUMBER OPERATIONS ==============
        case 'round': {
          const num = Number(value);
          if (isNaN(num)) return { success: false, error: 'Value must be a number' };
          const decimals = arg1 !== undefined && arg1 !== '' ? Number(arg1) : 0;
          const factor = Math.pow(10, decimals);
          return { success: true, result: Math.round(num * factor) / factor };
        }

        case 'floor': {
          const num = Number(value);
          if (isNaN(num)) return { success: false, error: 'Value must be a number' };
          return { success: true, result: Math.floor(num) };
        }

        case 'ceil': {
          const num = Number(value);
          if (isNaN(num)) return { success: false, error: 'Value must be a number' };
          return { success: true, result: Math.ceil(num) };
        }

        case 'abs': {
          const num = Number(value);
          if (isNaN(num)) return { success: false, error: 'Value must be a number' };
          return { success: true, result: Math.abs(num) };
        }

        case 'add': {
          const num = Number(value);
          const addend = Number(arg1);
          if (isNaN(num) || isNaN(addend)) return { success: false, error: 'Both values must be numbers' };
          return { success: true, result: num + addend };
        }

        case 'subtract': {
          const num = Number(value);
          const subtrahend = Number(arg1);
          if (isNaN(num) || isNaN(subtrahend)) return { success: false, error: 'Both values must be numbers' };
          return { success: true, result: num - subtrahend };
        }

        case 'multiply': {
          const num = Number(value);
          const multiplier = Number(arg1);
          if (isNaN(num) || isNaN(multiplier)) return { success: false, error: 'Both values must be numbers' };
          return { success: true, result: num * multiplier };
        }

        case 'divide': {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor)) return { success: false, error: 'Both values must be numbers' };
          if (divisor === 0) return { success: false, error: 'Cannot divide by zero' };
          return { success: true, result: num / divisor };
        }

        case 'modulo': {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor)) return { success: false, error: 'Both values must be numbers' };
          if (divisor === 0) return { success: false, error: 'Cannot modulo by zero' };
          return { success: true, result: num % divisor };
        }

        case 'toString': {
          return { success: true, result: String(value) };
        }

        // ============== DATETIME OPERATIONS ==============
        case 'formatDate': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          const format = String(arg1 || 'YYYY-MM-DD HH:mm:ss');
          
          const pad = (n: number) => n.toString().padStart(2, '0');
          const formatted = format
            .replace('YYYY', date.getFullYear().toString())
            .replace('MM', pad(date.getMonth() + 1))
            .replace('DD', pad(date.getDate()))
            .replace('HH', pad(date.getHours()))
            .replace('mm', pad(date.getMinutes()))
            .replace('ss', pad(date.getSeconds()));
          
          return { success: true, result: formatted };
        }

        case 'addDays': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() + days);
          return { success: true, result: date.toISOString() };
        }

        case 'subtractDays': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() - days);
          return { success: true, result: date.toISOString() };
        }

        case 'getYear': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getFullYear() };
        }

        case 'getMonth': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getMonth() + 1 };
        }

        case 'getDay': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getDate() };
        }

        case 'getHour': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getHours() };
        }

        case 'getMinute': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getMinutes() };
        }

        case 'toTimestamp': {
          const date = new Date(value);
          if (isNaN(date.getTime())) return { success: false, error: 'Invalid date value' };
          return { success: true, result: date.getTime() };
        }

        case 'fromTimestamp': {
          const timestamp = Number(value);
          if (isNaN(timestamp)) return { success: false, error: 'Invalid timestamp' };
          return { success: true, result: new Date(timestamp).toISOString() };
        }

        // ============== BOOLEAN OPERATIONS ==============
        case 'not': {
          return { success: true, result: !value };
        }

        case 'boolToString': {
          return { success: true, result: String(Boolean(value)) };
        }

        case 'boolToNumber': {
          return { success: true, result: value ? 1 : 0 };
        }

        // ============== ARRAY OPERATIONS ==============
        case 'arrayLength': {
          const arr = TransformService.toArray(value);
          return { success: true, result: arr.length };
        }

        case 'push': {
          const arr = [...TransformService.toArray(value)];
          const item = TransformService.parseValue(arg1);
          arr.push(item);
          return { success: true, result: arr };
        }

        case 'pop': {
          const arr = [...TransformService.toArray(value)];
          const popped = arr.pop();
          return { success: true, result: { array: arr, popped } };
        }

        case 'shift': {
          const arr = [...TransformService.toArray(value)];
          const shifted = arr.shift();
          return { success: true, result: { array: arr, shifted } };
        }

        case 'unshift': {
          const arr = [...TransformService.toArray(value)];
          const item = TransformService.parseValue(arg1);
          arr.unshift(item);
          return { success: true, result: arr };
        }

        case 'arrayConcat': {
          const arr1 = TransformService.toArray(value);
          const arr2 = TransformService.toArray(arg1);
          return { success: true, result: [...arr1, ...arr2] };
        }

        case 'slice': {
          const arr = TransformService.toArray(value);
          const start = arg1 !== undefined && arg1 !== '' ? Number(arg1) : 0;
          const end = arg2 !== undefined && arg2 !== '' ? Number(arg2) : undefined;
          return { success: true, result: arr.slice(start, end) };
        }

        case 'reverse': {
          const arr = [...TransformService.toArray(value)];
          return { success: true, result: arr.reverse() };
        }

        case 'sort': {
          const arr = [...TransformService.toArray(value)];
          const order = String(arg1 || 'asc').toLowerCase();
          arr.sort((a, b) => {
            if (typeof a === 'number' && typeof b === 'number') {
              return order === 'desc' ? b - a : a - b;
            }
            const strA = String(a);
            const strB = String(b);
            return order === 'desc' ? strB.localeCompare(strA) : strA.localeCompare(strB);
          });
          return { success: true, result: arr };
        }

        case 'unique': {
          const arr = TransformService.toArray(value);
          return { success: true, result: [...new Set(arr.map(item => 
            typeof item === 'object' ? JSON.stringify(item) : item
          ))].map(item => {
            try { return JSON.parse(item as string); } catch { return item; }
          }) };
        }

        case 'flatten': {
          const arr = TransformService.toArray(value);
          return { success: true, result: arr.flat(Infinity) };
        }

        case 'first': {
          const arr = TransformService.toArray(value);
          return { success: true, result: arr[0] ?? null };
        }

        case 'last': {
          const arr = TransformService.toArray(value);
          return { success: true, result: arr[arr.length - 1] ?? null };
        }

        case 'arrayContains': {
          const arr = TransformService.toArray(value);
          const item = TransformService.parseValue(arg1);
          const found = arr.some(el => {
            if (typeof el === 'object' && typeof item === 'object') {
              return JSON.stringify(el) === JSON.stringify(item);
            }
            return el === item;
          });
          return { success: true, result: found };
        }

        case 'arrayIsEmpty': {
          const arr = TransformService.toArray(value);
          return { success: true, result: arr.length === 0 };
        }

        case 'join': {
          const arr = TransformService.toArray(value);
          const delimiter = arg1 !== undefined ? String(arg1) : ',';
          return { success: true, result: arr.join(delimiter) };
        }

        // ============== OBJECT OPERATIONS ==============
        case 'keys': {
          const obj = TransformService.toObject(value);
          return { success: true, result: Object.keys(obj) };
        }

        case 'values': {
          const obj = TransformService.toObject(value);
          return { success: true, result: Object.values(obj) };
        }

        case 'entries': {
          const obj = TransformService.toObject(value);
          return { success: true, result: Object.entries(obj) };
        }

        case 'getProperty': {
          const obj = TransformService.toObject(value);
          const path = String(arg1 || '');
          const result = TransformService.getNestedValue(obj, path);
          return { success: true, result };
        }

        case 'setProperty': {
          const obj = { ...TransformService.toObject(value) };
          const path = String(arg1 || '');
          const newValue = TransformService.parseValue(arg2);
          TransformService.setNestedValue(obj, path, newValue);
          return { success: true, result: obj };
        }

        case 'deleteProperty': {
          const obj = { ...TransformService.toObject(value) };
          const path = String(arg1 || '');
          TransformService.deleteNestedValue(obj, path);
          return { success: true, result: obj };
        }

        case 'hasProperty': {
          const obj = TransformService.toObject(value);
          const path = String(arg1 || '');
          const result = TransformService.getNestedValue(obj, path);
          return { success: true, result: result !== undefined };
        }

        case 'merge': {
          const obj1 = TransformService.toObject(value);
          const obj2 = TransformService.toObject(arg1);
          return { success: true, result: { ...obj1, ...obj2 } };
        }

        case 'pick': {
          const obj = TransformService.toObject(value);
          const keys = String(arg1 || '').split(',').map(k => k.trim()).filter(Boolean);
          const result: Record<string, any> = {};
          for (const key of keys) {
            if (key in obj) {
              result[key] = obj[key];
            }
          }
          return { success: true, result };
        }

        case 'omit': {
          const obj = { ...TransformService.toObject(value) };
          const keys = String(arg1 || '').split(',').map(k => k.trim()).filter(Boolean);
          for (const key of keys) {
            delete obj[key];
          }
          return { success: true, result: obj };
        }

        case 'objectIsEmpty': {
          const obj = TransformService.toObject(value);
          return { success: true, result: Object.keys(obj).length === 0 };
        }

        default:
          return { success: false, error: `Unsupported operator: ${operator}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Helper: Convert value to array
  private static toArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Not JSON, return as single-item array
      }
    }
    return value !== undefined && value !== null ? [value] : [];
  }

  // Helper: Convert value to object
  private static toObject(value: any): Record<string, any> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Not valid JSON
      }
    }
    return {};
  }

  // Helper: Parse value (try JSON first)
  private static parseValue(value: any): any {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        // Return as string
      }
    }
    return value;
  }

  // Helper: Get nested value from object
  private static getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  // Helper: Set nested value in object
  private static setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
  }

  // Helper: Delete nested value from object
  private static deleteNestedValue(obj: any, path: string): void {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) return;
      current = current[key];
    }
    delete current[keys[keys.length - 1]];
  }
}
