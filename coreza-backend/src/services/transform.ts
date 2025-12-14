/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { 
  addDays, addWeeks, addMonths, addYears, addHours, addMinutes, addSeconds,
  subDays, subWeeks, subMonths, subYears, subHours, subMinutes, subSeconds,
  format, parse, parseISO,
  differenceInDays, differenceInHours, differenceInMinutes, differenceInSeconds,
  differenceInWeeks, differenceInMonths, differenceInYears,
  startOfDay, startOfWeek, startOfMonth, startOfYear,
  endOfDay, endOfWeek, endOfMonth, endOfYear,
  isBefore, isAfter, isSameDay, isWeekend,
  getYear, getMonth, getDate, getDay, getDayOfYear, getWeek,
  getHours, getMinutes, getSeconds,
  isValid
} from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

export interface TransformInput {
  value: any;
  operator: string;
  dataType?: string;
  arg1?: any;
  arg2?: any;
  arg3?: any;
  filterOperator?: string;
  // Date-specific fields
  date2?: any;
  unit?: string;
  timezone?: string;
  inputFormat?: string;
  targetDay?: string;
}

export interface Transformdata {
  success: boolean;
  data?: any;
  error?: string;
}

export class TransformService {
  /**
   * Parse input to Date object
   */
  private static parseDate(input: string | Date | undefined, inputFormat?: string): Date {
    if (!input) {
      return new Date();
    }
    
    if (input instanceof Date) {
      return input;
    }
    
    // Try parsing with inputFormat if provided
    if (inputFormat) {
      const parsed = parse(input, inputFormat, new Date());
      if (isValid(parsed)) return parsed;
    }
    
    // Try ISO format
    try {
      const parsed = parseISO(input);
      if (isValid(parsed)) return parsed;
    } catch {}
    
    // Try Date constructor
    const date = new Date(input);
    if (isValid(date)) return date;
    
    throw new Error(`Invalid date: ${input}`);
  }

  /**
   * Parse input into numeric array for statistical operations
   */
  private static parseToNumericArray(input: any): number[] {
    if (Array.isArray(input)) {
      return input.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    }

    if (typeof input === "string") {
      try {
        const parsed = JSON.parse(input);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
        }
      } catch {
        const parts = input.split(",").map((s) => Number(s.trim()));
        if (parts.every((n) => Number.isFinite(n))) {
          return parts;
        }
      }
    }

    const num = Number(input);
    if (Number.isFinite(num)) {
      return [num];
    }

    return [];
  }

  static transform(input: TransformInput): Transformdata {
    try {
      const { value, operator, arg1, arg2, arg3 } = input;

      switch (operator) {
        // ============== STRING OPERATIONS ==============
        case "len": {
          if (Array.isArray(value)) {
            return { success: true, data: value.length };
          }
          if (typeof value === "object" && value !== null) {
            return { success: true, data: Object.keys(value).length };
          }
          if (typeof value === "string") {
            const looksLikeJson = /^\s*[\[{]/.test(value);
            if (looksLikeJson) {
              try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                  return { success: true, data: parsed.length };
                }
                if (parsed && typeof parsed === "object") {
                  return { success: true, data: Object.keys(parsed).length };
                }
              } catch {
                // Not valid JSON → fall through to string length
              }
            }
            return { success: true, data: value.length };
          }
          return { success: true, data: String(value).length };
        }

        case "substring": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const start = Number(arg1) || 0;
          const length =
            arg2 !== undefined && arg2 !== "" ? Number(arg2) : undefined;
          const result =
            length !== undefined
              ? validation.string.substring(start, start + length)
              : validation.string.substring(start);
          return {
            success: true,
            data: result,
          };
        }

        case "trim": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.string.trim() };
        }

        case "upper": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.string.toUpperCase() };
        }

        case "lower": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.string.toLowerCase() };
        }

        case "replace": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const search = String(arg1 || "");
          const replacement = String(arg2 || "");
          return {
            success: true,
            data: validation.string.split(search).join(replacement),
          };
        }

        case "split": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const delimiter = arg1 !== undefined ? String(arg1) : ",";
          return { success: true, data: validation.string.split(delimiter) };
        }

        case "concat": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const appendStr = String(arg1 || "");
          return { success: true, data: validation.string + appendStr };
        }

        case "startsWith": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const prefix = String(arg1 || "");
          return { success: true, data: validation.string.startsWith(prefix) };
        }

        case "endsWith": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const suffix = String(arg1 || "");
          return { success: true, data: validation.string.endsWith(suffix) };
        }

        case "contains": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const substring = String(arg1 || "");
          return { success: true, data: validation.string.includes(substring) };
        }

        case "isEmpty": {
          const validation = TransformService.validateString(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.string.trim().length === 0 };
        }

        case "toJson": {
          if (typeof value !== "string") {
            return { success: false, error: "Value must be a string" };
          }
          // Try standard JSON parse first
          try {
            return { success: true, data: JSON.parse(value) };
          } catch {
            // Fall back to key-value parsing
          }

          let str = value.trim();
          if (str.startsWith("{") && str.endsWith("}")) {
            str = str.slice(1, -1).trim();
          }

          const pairs = str
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p);
          const data: Record<string, any> = {};

          for (const pair of pairs) {
            const colonIndex = pair.indexOf(":");
            if (colonIndex === -1) continue;

            const key = pair.substring(0, colonIndex).trim();
            let val: any = pair.substring(colonIndex + 1).trim();

            if (!isNaN(Number(val)) && val !== "") {
              val = Number(val);
            } else if (val.toLowerCase() === "true") {
              val = true;
            } else if (val.toLowerCase() === "false") {
              val = false;
            } else if (val.toLowerCase() === "null") {
              val = null;
            }

            data[key] = val;
          }

          return { success: true, data };
        }

        // ============== NUMBER OPERATIONS ==============
        case "round": {
          const num = Number(value);
          if (isNaN(num))
            return { success: false, error: "Value must be a number" };
          const decimals = arg1 !== undefined && arg1 !== "" ? Number(arg1) : 0;
          const factor = Math.pow(10, decimals);
          return { success: true, data: Math.round(num * factor) / factor };
        }

        case "floor": {
          const num = Number(value);
          if (isNaN(num))
            return { success: false, error: "Value must be a number" };
          return { success: true, data: Math.floor(num) };
        }

        case "ceil": {
          const num = Number(value);
          if (isNaN(num))
            return { success: false, error: "Value must be a number" };
          return { success: true, data: Math.ceil(num) };
        }

        case "abs": {
          const num = Number(value);
          if (isNaN(num))
            return { success: false, error: "Value must be a number" };
          return { success: true, data: Math.abs(num) };
        }

        case "add": {
          const num = Number(value);
          const addend = Number(arg1);
          if (isNaN(num) || isNaN(addend))
            return { success: false, error: "Both values must be numbers" };
          return { success: true, data: num + addend };
        }

        case "subtract": {
          const num = Number(value);
          const subtrahend = Number(arg1);
          if (isNaN(num) || isNaN(subtrahend))
            return { success: false, error: "Both values must be numbers" };
          return { success: true, data: num - subtrahend };
        }

        case "multiply": {
          const num = Number(value);
          const multiplier = Number(arg1);
          if (isNaN(num) || isNaN(multiplier))
            return { success: false, error: "Both values must be numbers" };
          return { success: true, data: num * multiplier };
        }

        case "divide": {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor))
            return { success: false, error: "Both values must be numbers" };
          if (divisor === 0)
            return { success: false, error: "Cannot divide by zero" };
          return { success: true, data: num / divisor };
        }

        case "modulo": {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor))
            return { success: false, error: "Both values must be numbers" };
          if (divisor === 0)
            return { success: false, error: "Cannot modulo by zero" };
          return { success: true, data: num % divisor };
        }

        case "toString": {
          return { success: true, data: String(value) };
        }

        // ============== DATETIME OPERATIONS ==============
        case "formatDate": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          const format = String(arg1 || "YYYY-MM-DD HH:mm:ss");

          const pad = (n: number) => n.toString().padStart(2, "0");
          const formatted = format
            .replace("YYYY", date.getFullYear().toString())
            .replace("MM", pad(date.getMonth() + 1))
            .replace("DD", pad(date.getDate()))
            .replace("HH", pad(date.getHours()))
            .replace("mm", pad(date.getMinutes()))
            .replace("ss", pad(date.getSeconds()));

          return { success: true, data: formatted };
        }

        case "addDays": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() + days);
          return { success: true, data: date.toISOString() };
        }

        case "subtractDays": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() - days);
          return { success: true, data: date.toISOString() };
        }

        case "getYear": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getFullYear() };
        }

        case "getMonth": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getMonth() + 1 };
        }

        case "getDay": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getDate() };
        }

        case "getHour": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getHours() };
        }

        case "getMinute": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getMinutes() };
        }

        case "toTimestamp": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return { success: false, error: "Invalid date value" };
          return { success: true, data: date.getTime() };
        }

        case "fromTimestamp": {
          const timestamp = Number(value);
          if (isNaN(timestamp))
            return { success: false, error: "Invalid timestamp" };
          return { success: true, data: new Date(timestamp).toISOString() };
        }

        // ============== ADVANCED DATE OPERATIONS (from DateService) ==============
        case "now": {
          const formatStr = arg1 || 'yyyy-MM-dd HH:mm:ss';
          const timezone = input.timezone;
          if (timezone) {
            return { success: true, data: formatInTimeZone(new Date(), timezone, formatStr) };
          }
          return { success: true, data: format(new Date(), formatStr) };
        }

        case "today": {
          const formatStr = arg1 || 'yyyy-MM-dd';
          return { success: true, data: format(startOfDay(new Date()), formatStr) };
        }

        case "addTime": {
          const date = this.parseDate(value, input.inputFormat);
          const amount = Number(arg1) || 0;
          const unit = input.unit || 'days';
          
          let result: Date;
          switch (unit) {
            case 'seconds': result = addSeconds(date, amount); break;
            case 'minutes': result = addMinutes(date, amount); break;
            case 'hours': result = addHours(date, amount); break;
            case 'days': result = addDays(date, amount); break;
            case 'weeks': result = addWeeks(date, amount); break;
            case 'months': result = addMonths(date, amount); break;
            case 'years': result = addYears(date, amount); break;
            default: return { success: false, error: `Invalid unit: ${unit}` };
          }
          
          const formatStr = arg2 || 'yyyy-MM-dd HH:mm:ss';
          return { success: true, data: format(result, formatStr) };
        }

        case "subtractTime": {
          const date = this.parseDate(value, input.inputFormat);
          const amount = Number(arg1) || 0;
          const unit = input.unit || 'days';
          
          let result: Date;
          switch (unit) {
            case 'seconds': result = subSeconds(date, amount); break;
            case 'minutes': result = subMinutes(date, amount); break;
            case 'hours': result = subHours(date, amount); break;
            case 'days': result = subDays(date, amount); break;
            case 'weeks': result = subWeeks(date, amount); break;
            case 'months': result = subMonths(date, amount); break;
            case 'years': result = subYears(date, amount); break;
            default: return { success: false, error: `Invalid unit: ${unit}` };
          }
          
          const formatStr = arg2 || 'yyyy-MM-dd HH:mm:ss';
          return { success: true, data: format(result, formatStr) };
        }

        case "difference": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          const unit = input.unit || 'days';
          
          let result: number;
          switch (unit) {
            case 'seconds': result = differenceInSeconds(date1, date2); break;
            case 'minutes': result = differenceInMinutes(date1, date2); break;
            case 'hours': result = differenceInHours(date1, date2); break;
            case 'days': result = differenceInDays(date1, date2); break;
            case 'weeks': result = differenceInWeeks(date1, date2); break;
            case 'months': result = differenceInMonths(date1, date2); break;
            case 'years': result = differenceInYears(date1, date2); break;
            default: return { success: false, error: `Invalid unit: ${unit}` };
          }
          
          return { success: true, data: result };
        }

        case "startOf": {
          const date = this.parseDate(value, input.inputFormat);
          const unit = input.unit || 'day';
          
          let result: Date;
          switch (unit) {
            case 'day': result = startOfDay(date); break;
            case 'week': result = startOfWeek(date); break;
            case 'month': result = startOfMonth(date); break;
            case 'year': result = startOfYear(date); break;
            default: return { success: false, error: `Invalid unit: ${unit}` };
          }
          
          const formatStr = arg1 || 'yyyy-MM-dd HH:mm:ss';
          return { success: true, data: format(result, formatStr) };
        }

        case "endOf": {
          const date = this.parseDate(value, input.inputFormat);
          const unit = input.unit || 'day';
          
          let result: Date;
          switch (unit) {
            case 'day': result = endOfDay(date); break;
            case 'week': result = endOfWeek(date); break;
            case 'month': result = endOfMonth(date); break;
            case 'year': result = endOfYear(date); break;
            default: return { success: false, error: `Invalid unit: ${unit}` };
          }
          
          const formatStr = arg1 || 'yyyy-MM-dd HH:mm:ss';
          return { success: true, data: format(result, formatStr) };
        }

        case "isBefore": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return { success: true, data: isBefore(date1, date2) };
        }

        case "isAfter": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return { success: true, data: isAfter(date1, date2) };
        }

        case "isSameDay": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return { success: true, data: isSameDay(date1, date2) };
        }

        case "isWeekend": {
          const date = this.parseDate(value, input.inputFormat);
          return { success: true, data: isWeekend(date) };
        }

        case "isDayOfWeek": {
          const date = this.parseDate(value, input.inputFormat);
          const targetDay = parseInt(input.targetDay ?? '1', 10);

          if (Number.isNaN(targetDay) || targetDay < 0 || targetDay > 6) {
            return { success: false, error: `Invalid target day: ${input.targetDay}` };
          }

          const actualDay = getDay(date);
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

          return {
            success: true,
            data: {
              isMatch: actualDay === targetDay,
              dayName: dayNames[actualDay],
              targetDayName: dayNames[targetDay]
            }
          };
        }

        case "convertTimezone": {
          const date = this.parseDate(value, input.inputFormat);
          const timezone = input.timezone || 'UTC';
          const formatStr = arg1 || 'yyyy-MM-dd HH:mm:ss';

          const zonedDate = toZonedTime(date, timezone);
          return { success: true, data: format(zonedDate, formatStr) };
        }

        case "extract": {
          const date = this.parseDate(value, input.inputFormat);
          const component = input.unit || 'year';
          
          let result: number;
          switch (component) {
            case 'year': result = getYear(date); break;
            case 'month': result = getMonth(date) + 1; break;
            case 'date': result = getDate(date); break;
            case 'day': result = getDay(date); break;
            case 'dayOfYear': result = getDayOfYear(date); break;
            case 'week': result = getWeek(date); break;
            case 'hour': result = getHours(date); break;
            case 'minute': result = getMinutes(date); break;
            case 'second': result = getSeconds(date); break;
            default: return { success: false, error: `Invalid component: ${component}` };
          }
          
          return { success: true, data: result };
        }

        // ============== BOOLEAN OPERATIONS ==============
        case "not": {
          return { success: true, data: !value };
        }

        case "boolToString": {
          return { success: true, data: String(Boolean(value)) };
        }

        case "boolToNumber": {
          return { success: true, data: value ? 1 : 0 };
        }

        // ============== ARRAY OPERATIONS ==============
        case "arrayLength": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.array.length };
        }

        case "push": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const arr = [...validation.array];
          const item = TransformService.parseValue(arg1);
          arr.push(item);
          return { success: true, data: arr };
        }

        case "pop": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const arr = [...validation.array];
          const popped = arr.pop();
          return { success: true, data: { array: arr, popped } };
        }

        case "shift": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const arr = [...validation.array];
          const shifted = arr.shift();
          return { success: true, data: { array: arr, shifted } };
        }

        case "unshift": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const arr = [...validation.array];
          const item = TransformService.parseValue(arg1);
          arr.unshift(item);
          return { success: true, data: arr };
        }

        case "arrayConcat": {
          const validation1 = TransformService.validateArray(value);
          if (!validation1.valid)
            return { success: false, error: validation1.error };
          const validation2 = TransformService.validateArray(arg1);
          if (!validation2.valid)
            return { success: false, error: "Second value must be an array" };
          return {
            success: true,
            data: [...validation1.array, ...validation2.array],
          };
        }

        case "slice": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const start = arg1 !== undefined && arg1 !== "" ? Number(arg1) : 0;
          const end =
            arg2 !== undefined && arg2 !== "" ? Number(arg2) : undefined;
          return { success: true, data: validation.array.slice(start, end) };
        }

        case "reverse": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: [...validation.array].reverse() };
        }

        case "sort": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const arr = [...validation.array];
          const order = String(arg1 || "asc").toLowerCase();
          arr.sort((a, b) => {
            if (typeof a === "number" && typeof b === "number") {
              return order === "desc" ? b - a : a - b;
            }
            const strA = String(a);
            const strB = String(b);
            return order === "desc"
              ? strB.localeCompare(strA)
              : strA.localeCompare(strB);
          });
          return { success: true, data: arr };
        }

        case "unique": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return {
            success: true,
            data: [
              ...new Set(
                validation.array.map((item) =>
                  typeof item === "object" ? JSON.stringify(item) : item
                )
              ),
            ].map((item) => {
              try {
                return JSON.parse(item as string);
              } catch {
                return item;
              }
            }),
          };
        }

        case "flatten": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.array.flat(Infinity) };
        }

        case "first": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.array[0] ?? null };
        }

        case "last": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return {
            success: true,
            data: validation.array[validation.array.length - 1] ?? null,
          };
        }

        case "arrayContains": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const item = TransformService.parseValue(arg1);
          const found = validation.array.some((el) => {
            if (typeof el === "object" && typeof item === "object") {
              return JSON.stringify(el) === JSON.stringify(item);
            }
            return el === item;
          });
          return { success: true, data: found };
        }

        case "arrayIsEmpty": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: validation.array.length === 0 };
        }

        case "join": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const delimiter = arg1 !== undefined ? String(arg1) : ",";
          return { success: true, data: validation.array.join(delimiter) };
        }

        // ============== STATISTICAL OPERATIONS (from MathService) ==============
        case "avg": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return { success: false, error: "Cannot calculate average of empty array" };
          return { success: true, data: values.reduce((sum, v) => sum + v, 0) / values.length };
        }

        case "sum": {
          const values = this.parseToNumericArray(value);
          return { success: true, data: values.reduce((sum, v) => sum + v, 0) };
        }

        case "min": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return { success: false, error: "Cannot find min of empty array" };
          return { success: true, data: Math.min(...values) };
        }

        case "max": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return { success: false, error: "Cannot find max of empty array" };
          return { success: true, data: Math.max(...values) };
        }

        case "count": {
          const values = this.parseToNumericArray(value);
          return { success: true, data: values.length };
        }

        case "median": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return { success: false, error: "Cannot calculate median of empty array" };
          const sorted = [...values].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return {
            success: true,
            data: sorted.length % 2 === 0
              ? (sorted[mid - 1] + sorted[mid]) / 2
              : sorted[mid]
          };
        }

        case "std": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return { success: false, error: "Cannot calculate std of empty array" };
          const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
          const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
          const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
          return { success: true, data: Math.sqrt(variance) };
        }

        case "find": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const propertyName = String(arg1 || "");
          const matchValue = TransformService.parseValue(arg2);
          const operator = String(input.filterOperator || "===");
          const found = validation.array.find((item) => {
            if (item && typeof item === "object") {
              const itemValue = item[propertyName];
              return TransformService.compareValues(
                itemValue,
                operator,
                matchValue
              );
            }
            return false;
          });
          return { success: true, data: found ?? null };
        }

        case "filter": {
          const validation = TransformService.validateArray(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const propertyName = String(arg1 || "");
          const matchValue = TransformService.parseValue(arg2);
          const operator = String(input.filterOperator || "===");
          const filtered = validation.array.filter((item) => {
            if (item && typeof item === "object") {
              const itemValue = item[propertyName];
              return TransformService.compareValues(
                itemValue,
                operator,
                matchValue
              );
            }
            return false;
          });
          return { success: true, data: filtered };
        }

        // ============== OBJECT OPERATIONS ==============
        case "keys": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: Object.keys(validation.object) };
        }

        case "values": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: Object.values(validation.object) };
        }

        case "entries": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return { success: true, data: Object.entries(validation.object) };
        }

        case "getProperty": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const path = String(arg1 || "");
          const data = TransformService.getNestedValue(validation.object, path);
          return { success: true, data };
        }

        case "setProperty": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const obj = { ...validation.object };
          const path = String(arg1 || "");
          const newValue = TransformService.parseValue(arg2);
          TransformService.setNestedValue(obj, path, newValue);
          return { success: true, data: obj };
        }

        case "deleteProperty": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const obj = { ...validation.object };
          const path = String(arg1 || "");
          TransformService.deleteNestedValue(obj, path);
          return { success: true, data: obj };
        }

        case "hasProperty": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const path = String(arg1 || "");
          const data = TransformService.getNestedValue(validation.object, path);
          return { success: true, data: data !== undefined };
        }

        case "merge": {
          const validation1 = TransformService.validateObject(value);
          if (!validation1.valid)
            return { success: false, error: validation1.error };
          const validation2 = TransformService.validateObject(arg1);
          if (!validation2.valid)
            return { success: false, error: "Second value must be an object" };
          return {
            success: true,
            data: { ...validation1.object, ...validation2.object },
          };
        }

        case "pick": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const keys = String(arg1 || "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          const data: Record<string, any> = {};
          for (const key of keys) {
            if (key in validation.object) {
              data[key] = validation.object[key];
            }
          }
          return { success: true, data };
        }

        case "omit": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          const obj = { ...validation.object };
          const keys = String(arg1 || "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          for (const key of keys) {
            delete obj[key];
          }
          return { success: true, data: obj };
        }

        case "objectIsEmpty": {
          const validation = TransformService.validateObject(value);
          if (!validation.valid)
            return { success: false, error: validation.error };
          return {
            success: true,
            data: Object.keys(validation.object).length === 0,
          };
        }

        default:
          return { success: false, error: `Unsupported operator: ${operator}` };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // Helper: Validate and convert value to array (strict)
  private static validateArray(
    value: any
  ): { valid: true; array: any[] } | { valid: false; error: string } {
    if (Array.isArray(value)) {
      return { valid: true, array: value };
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return { valid: true, array: parsed };
        }
      } catch {
        // Not valid JSON
      }
    }
    return { valid: false, error: "Value must be an array" };
  }

  // Helper: Validate and convert value to object (strict)
  private static validateObject(
    value: any
  ):
    | { valid: true; object: Record<string, any> }
    | { valid: false; error: string } {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return { valid: true, object: value };
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          return { valid: true, object: parsed };
        }
      } catch {
        // Not valid JSON
      }
    }
    return { valid: false, error: "Value must be an object" };
  }

  // Helper: Validate value is a string (strict)
  private static validateString(
    value: any
  ): { valid: true; string: string } | { valid: false; error: string } {
    if (typeof value === "string") {
      return { valid: true, string: value };
    }
    return { valid: false, error: "Value must be a string" };
  }

  // Helper: Parse value (try JSON first)
  private static parseValue(value: any): any {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        // Return as string
      }
    }
    return value;
  }

  // Helper: Compare two values with support for common operators
  private static compareValues(
    itemValue: any,
    operator: string,
    matchValue: any
  ): boolean {
    const normalizedOperator = operator || "===";

    const toNumber = (val: any) => {
      const num = Number(val);
      return Number.isNaN(num) ? null : num;
    };

    const toStringValue = (val: any) =>
      val === undefined || val === null ? "" : String(val);

    switch (normalizedOperator) {
      case "===":
        return TransformService.areValuesEqual(itemValue, matchValue);
      case "!==":
        return !TransformService.areValuesEqual(itemValue, matchValue);
      case ">": {
        const left = toNumber(itemValue);
        const right = toNumber(matchValue);
        return left !== null && right !== null ? left > right : false;
      }
      case ">=": {
        const left = toNumber(itemValue);
        const right = toNumber(matchValue);
        return left !== null && right !== null ? left >= right : false;
      }
      case "<": {
        const left = toNumber(itemValue);
        const right = toNumber(matchValue);
        return left !== null && right !== null ? left < right : false;
      }
      case "<=": {
        const left = toNumber(itemValue);
        const right = toNumber(matchValue);
        return left !== null && right !== null ? left <= right : false;
      }
      case "contains": {
        if (itemValue === undefined || itemValue === null) return false;
        if (Array.isArray(itemValue)) {
          return itemValue.some((entry) =>
            TransformService.areValuesEqual(entry, matchValue)
          );
        }
        return toStringValue(itemValue).includes(toStringValue(matchValue));
      }
      case "does_not_contain": {
        return !TransformService.compareValues(
          itemValue,
          "contains",
          matchValue
        );
      }
      case "starts_with": {
        return toStringValue(itemValue).startsWith(toStringValue(matchValue));
      }
      case "ends_with": {
        return toStringValue(itemValue).endsWith(toStringValue(matchValue));
      }
      case "is_empty": {
        if (itemValue === undefined || itemValue === null) return true;
        if (typeof itemValue === "string") return itemValue.length === 0;
        if (Array.isArray(itemValue)) return itemValue.length === 0;
        if (typeof itemValue === "object")
          return Object.keys(itemValue).length === 0;
        return false;
      }
      case "is_not_empty": {
        return !TransformService.compareValues(
          itemValue,
          "is_empty",
          matchValue
        );
      }
      case "matches_regex": {
        try {
          const regex = new RegExp(toStringValue(matchValue));
          return regex.test(toStringValue(itemValue));
        } catch {
          return false;
        }
      }
      default:
        return TransformService.areValuesEqual(itemValue, matchValue);
    }
  }

  private static areValuesEqual(a: any, b: any): boolean {
    if (typeof a === "object" && typeof b === "object") {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return a === b;
  }

  // Helper: Get nested value from object
  private static getNestedValue(obj: any, path: string): any {
    const keys = path.split(".");
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  }

  // Helper: Set nested value in object
  private static setNestedValue(obj: any, path: string, value: any): void {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
    current[keys[keys.length - 1]] = value;
  }

  // Helper: Delete nested value from object
  private static deleteNestedValue(obj: any, path: string): void {
    const keys = path.split(".");
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) return;
      current = current[key];
    }
    delete current[keys[keys.length - 1]];
  }
}
