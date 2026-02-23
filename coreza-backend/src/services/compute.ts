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
  addDays,
  addWeeks,
  addMonths,
  addYears,
  addHours,
  addMinutes,
  addSeconds,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  subHours,
  subMinutes,
  subSeconds,
  format,
  parse,
  parseISO,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  differenceInWeeks,
  differenceInMonths,
  differenceInYears,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  endOfDay,
  endOfWeek,
  endOfMonth,
  endOfYear,
  isBefore,
  isAfter,
  isSameDay,
  isWeekend,
  getYear,
  getMonth,
  getDate,
  getDay,
  getDayOfYear,
  getWeek,
  getHours,
  getMinutes,
  getSeconds,
  isValid,
} from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../utils/normalizeOutput";
import type { StandardNodeOutput, NormalizeContext } from "../types/nodeOutput";

export interface ComputeInput {
  value: any;
  operator: string;
  dataType?: string;
  arg1?: any;
  arg2?: any;
  arg3?: any;
  filterOperator?: string;
  mapSubOperation?: string;
  mapIndex?: string | number;
  // Date-specific fields
  date2?: any;
  unit?: string;
  timezone?: string;
  inputFormat?: string;
  targetDay?: string;
}

export interface ComputeResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ComputeService {
  /**
   * Parse input to Date object
   */
  private static parseDate(
    input: string | Date | undefined,
    inputFormat?: string,
  ): Date {
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

  static compute(input: ComputeInput): StandardNodeOutput {
    try {
      const {
        value,
        operator,
        arg1,
        arg2,
        filterOperator,
        unit,
        timezone,
        inputFormat,
        targetDay,
      } = input;

      switch (operator) {
        // ============== STRING OPERATIONS ==============
        case "len": {
          if (Array.isArray(value)) {
            return createSuccessOutput(value.length);
          }
          if (typeof value === "object" && value !== null) {
            return createSuccessOutput(Object.keys(value).length);
          }
          if (typeof value === "string") {
            const looksLikeJson = /^\s*[\[{]/.test(value);
            if (looksLikeJson) {
              try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                  return createSuccessOutput(parsed.length);
                }
                if (parsed && typeof parsed === "object") {
                  return createSuccessOutput(Object.keys(parsed).length);
                }
              } catch {
                // Not valid JSON → fall through to string length
              }
            }
            return createSuccessOutput(value.length);
          }
          return createSuccessOutput(String(value).length);
        }

        case "substring": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const start = Number(arg1) || 0;
          const length =
            arg2 !== undefined && arg2 !== "" ? Number(arg2) : undefined;
          const result =
            length !== undefined
              ? validation.string.substring(start, start + length)
              : validation.string.substring(start);
          return createSuccessOutput(result);
        }

        case "trim": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.string.trim());
        }

        case "upper": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.string.toUpperCase());
        }

        case "lower": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.string.toLowerCase());
        }

        case "replace": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const search = String(arg1 || "");
          const replacement = String(arg2 || "");
          return createSuccessOutput(
            validation.string.split(search).join(replacement),
          );
        }

        case "split": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const delimiter = arg1 !== undefined ? String(arg1) : ",";
          return createSuccessOutput(validation.string.split(delimiter));
        }

        case "concat": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const appendStr = String(arg1 || "");
          return createSuccessOutput(validation.string + appendStr);
        }

        case "startsWith": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const prefix = String(arg1 || "");
          return createSuccessOutput(validation.string.startsWith(prefix));
        }

        case "endsWith": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const suffix = String(arg1 || "");
          return createSuccessOutput(validation.string.endsWith(suffix));
        }

        case "contains": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const substring = String(arg1 || "");
          return createSuccessOutput(validation.string.includes(substring));
        }

        case "isEmpty": {
          const validation = this.validateString(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.string.trim().length === 0);
        }

        case "toJson": {
          if (typeof value !== "string") {
            return createErrorOutput("Value must be a string");
          }
          // Try standard JSON parse first
          try {
            return createSuccessOutput(JSON.parse(value));
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

          return createSuccessOutput(data);
        }

        // ============== NUMBER OPERATIONS ==============
        case "round": {
          const num = Number(value);
          if (isNaN(num)) return createErrorOutput("Value must be a number");
          const decimals = arg1 !== undefined && arg1 !== "" ? Number(arg1) : 0;
          const factor = Math.pow(10, decimals);
          return createSuccessOutput(Math.round(num * factor) / factor);
        }

        case "floor": {
          const num = Number(value);
          if (isNaN(num)) return createErrorOutput("Value must be a number");
          return createSuccessOutput(Math.floor(num));
        }

        case "ceil": {
          const num = Number(value);
          if (isNaN(num)) return createErrorOutput("Value must be a number");
          return createSuccessOutput(Math.ceil(num));
        }

        case "abs": {
          const num = Number(value);
          if (isNaN(num)) return createErrorOutput("Value must be a number");
          return createSuccessOutput(Math.abs(num));
        }

        case "add": {
          const num = Number(value);
          const addend = Number(arg1);
          if (isNaN(num) || isNaN(addend))
            return createErrorOutput("Both values must be numbers");
          return createSuccessOutput(num + addend);
        }

        case "subtract": {
          const num = Number(value);
          const subtrahend = Number(arg1);
          if (isNaN(num) || isNaN(subtrahend))
            return createErrorOutput("Both values must be numbers");
          return createSuccessOutput(num - subtrahend);
        }

        case "multiply": {
          const num = Number(value);
          const multiplier = Number(arg1);
          if (isNaN(num) || isNaN(multiplier))
            return createErrorOutput("Both values must be numbers");
          return createSuccessOutput(num * multiplier);
        }

        case "divide": {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor))
            return createErrorOutput("Both values must be numbers");
          if (divisor === 0) return createErrorOutput("Cannot divide by zero");
          return createSuccessOutput(num / divisor);
        }

        case "modulo": {
          const num = Number(value);
          const divisor = Number(arg1);
          if (isNaN(num) || isNaN(divisor))
            return createErrorOutput("Both values must be numbers");
          if (divisor === 0) return createErrorOutput("Cannot modulo by zero");
          return createSuccessOutput(num % divisor);
        }

        case "toString": {
          return createSuccessOutput(String(value));
        }

        // ============== DATETIME OPERATIONS ==============
        case "formatDate": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          const formatStr = String(arg1 || "YYYY-MM-DD HH:mm:ss");

          const pad = (n: number) => n.toString().padStart(2, "0");
          const formatted = formatStr
            .replace("YYYY", date.getFullYear().toString())
            .replace("MM", pad(date.getMonth() + 1))
            .replace("DD", pad(date.getDate()))
            .replace("HH", pad(date.getHours()))
            .replace("mm", pad(date.getMinutes()))
            .replace("ss", pad(date.getSeconds()));

          return createSuccessOutput(formatted);
        }

        case "addDays": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() + days);
          return createSuccessOutput(date.toISOString());
        }

        case "subtractDays": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          const days = Number(arg1) || 0;
          date.setDate(date.getDate() - days);
          return createSuccessOutput(date.toISOString());
        }

        case "getYear": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getFullYear());
        }

        case "getMonth": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getMonth() + 1);
        }

        case "getDay": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getDate());
        }

        case "getHour": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getHours());
        }

        case "getMinute": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getMinutes());
        }

        case "toTimestamp": {
          const date = new Date(value);
          if (isNaN(date.getTime()))
            return createErrorOutput("Invalid date value");
          return createSuccessOutput(date.getTime());
        }

        // ============== ADVANCED DATE OPERATIONS (from DateService) ==============
        case "now": {
          const formatStr = arg1 || "yyyy-MM-dd HH:mm:ss";
          const tz = input.timezone;
          if (tz) {
            return createSuccessOutput(
              formatInTimeZone(new Date(), tz, formatStr),
            );
          }
          return createSuccessOutput(format(new Date(), formatStr));
        }

        case "addTime": {
          const date = this.parseDate(value);
          const amount = Number(arg1) || 0;
          const unitValue = input.unit || "days";

          let result: Date;
          switch (unitValue) {
            case "second":
              result = addSeconds(date, amount);
              break;
            case "minute":
              result = addMinutes(date, amount);
              break;
            case "hour":
              result = addHours(date, amount);
              break;
            case "day":
              result = addDays(date, amount);
              break;
            case "week":
              result = addWeeks(date, amount);
              break;
            case "month":
              result = addMonths(date, amount);
              break;
            case "year":
              result = addYears(date, amount);
              break;
            default:
              return createErrorOutput(`Invalid unit: ${unitValue}`);
          }

          return createSuccessOutput(result);
        }

        case "subtractTime": {
          const date = this.parseDate(value);
          const amount = Number(arg1) || 0;
          const unitValue = input.unit || "days";

          let result: Date;
          switch (unitValue) {
            case "second":
              result = subSeconds(date, amount);
              break;
            case "minute":
              result = subMinutes(date, amount);
              break;
            case "hour":
              result = subHours(date, amount);
              break;
            case "day":
              result = subDays(date, amount);
              break;
            case "week":
              result = subWeeks(date, amount);
              break;
            case "month":
              result = subMonths(date, amount);
              break;
            case "year":
              result = subYears(date, amount);
              break;
            default:
              return createErrorOutput(`Invalid unit: ${unitValue}`);
          }

          return createSuccessOutput(result);
        }

        case "difference": {
          const date1 = this.parseDate(value);
          const date2 = this.parseDate(input.date2);
          const unitValue = input.unit;

          let result: number;
          switch (unitValue) {
            case "second":
              result = differenceInSeconds(date1, date2);
              break;
            case "minute":
              result = differenceInMinutes(date1, date2);
              break;
            case "hour":
              result = differenceInHours(date1, date2);
              break;
            case "day":
              result = differenceInDays(date1, date2);
              break;
            case "week":
              result = differenceInWeeks(date1, date2);
              break;
            case "month":
              result = differenceInMonths(date1, date2);
              break;
            case "year":
              result = differenceInYears(date1, date2);
              break;
            default:
              return createErrorOutput(`Invalid unit: ${unitValue}`);
          }

          return createSuccessOutput(Math.abs(result));
        }

        case "startOf": {
          const date = this.parseDate(value);
          const unitValue = input.unit || "day";

          let result: Date;
          switch (unitValue) {
            case "day":
              result = startOfDay(date);
              break;
            case "week":
              result = startOfWeek(date);
              break;
            case "month":
              result = startOfMonth(date);
              break;
            case "year":
              result = startOfYear(date);
              break;
            default:
              return createErrorOutput(`Invalid unit: ${unitValue}`);
          }

          return createSuccessOutput(result);
        }

        case "endOf": {
          const date = this.parseDate(value, input.inputFormat);
          const unitValue = input.unit || "day";

          let result: Date;
          switch (unitValue) {
            case "day":
              result = endOfDay(date);
              break;
            case "week":
              result = endOfWeek(date);
              break;
            case "month":
              result = endOfMonth(date);
              break;
            case "year":
              result = endOfYear(date);
              break;
            default:
              return createErrorOutput(`Invalid unit: ${unitValue}`);
          }

          return createSuccessOutput(result);
        }

        case "isBefore": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return createSuccessOutput(isBefore(date1, date2));
        }

        case "isAfter": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return createSuccessOutput(isAfter(date1, date2));
        }

        case "isSameDay": {
          const date1 = this.parseDate(value, input.inputFormat);
          const date2 = this.parseDate(input.date2);
          return createSuccessOutput(isSameDay(date1, date2));
        }

        case "isWeekend": {
          const date = this.parseDate(value, input.inputFormat);
          return createSuccessOutput(isWeekend(date));
        }

        case "isDayOfWeek": {
          const date = this.parseDate(value, input.inputFormat);
          const targetDayNum = parseInt(input.targetDay ?? "1", 10);

          if (
            Number.isNaN(targetDayNum) ||
            targetDayNum < 0 ||
            targetDayNum > 6
          ) {
            return createErrorOutput(`Invalid target day: ${input.targetDay}`);
          }

          const actualDay = getDay(date);
          const dayNames = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ];

          return createSuccessOutput({
            isMatch: actualDay === targetDayNum,
            dayName: dayNames[actualDay],
            targetDayName: dayNames[targetDayNum],
          });
        }

        case "convertTimezone": {
          const date = this.parseDate(value, input.inputFormat);
          const tz = input.timezone || "UTC";
          const formatStr = arg1 || "yyyy-MM-dd HH:mm:ss";

          const zonedDate = toZonedTime(date, tz);
          return createSuccessOutput(format(zonedDate, formatStr));
        }

        case "extract": {
          const date = this.parseDate(value);
          const component = input.unit || "year";

          let result: number;
          switch (component) {
            case "year":
              result = getYear(date);
              break;
            case "month":
              result = getMonth(date) + 1;
              break;
            case "day":
              result = getDate(date);
              break;
            case "hour":
              result = getHours(date);
              break;
            case "minute":
              result = getMinutes(date);
              break;
            case "second":
              result = getSeconds(date);
              break;
            default:
              return createErrorOutput(`Invalid component: ${component}`);
          }

          return createSuccessOutput(result);
        }

        // ============== ARRAY OPERATIONS ==============
        case "arrayLength": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.array.length);
        }

        case "push": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const arr = [...validation.array];
          const item = this.parseValue(arg1);
          arr.push(item);
          return createSuccessOutput(arr);
        }

        case "pop": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const arr = [...validation.array];
          const popped = arr.pop();
          return createSuccessOutput({ array: arr, popped });
        }

        case "shift": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const arr = [...validation.array];
          const shifted = arr.shift();
          return createSuccessOutput({ array: arr, shifted });
        }

        case "unshift": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const arr = [...validation.array];
          const item = this.parseValue(arg1);
          arr.unshift(item);
          return createSuccessOutput(arr);
        }

        case "arrayConcat": {
          const validation1 = this.validateArray(value);
          if (!validation1.valid) return createErrorOutput(validation1.error);
          const validation2 = this.validateArray(arg1);
          if (!validation2.valid)
            return createErrorOutput("Second value must be an array");
          return createSuccessOutput([
            ...validation1.array,
            ...validation2.array,
          ]);
        }

        case "slice": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const start = arg1 !== undefined && arg1 !== "" ? Number(arg1) : 0;
          const end =
            arg2 !== undefined && arg2 !== "" ? Number(arg2) : undefined;
          return createSuccessOutput(validation.array.slice(start, end));
        }

        case "reverse": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput([...validation.array].reverse());
        }

        case "sort": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
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
          return createSuccessOutput(arr);
        }

        case "unique": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const uniqueArr = [
            ...new Set(
              validation.array.map((item) =>
                typeof item === "object" ? JSON.stringify(item) : item,
              ),
            ),
          ].map((item) => {
            try {
              return JSON.parse(item as string);
            } catch {
              return item;
            }
          });
          return createSuccessOutput(uniqueArr);
        }

        case "flatten": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.array.flat(Infinity));
        }

        case "first": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.array[0] ?? null);
        }

        case "last": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(
            validation.array[validation.array.length - 1] ?? null,
          );
        }

        case "arrayContains": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const item = this.parseValue(arg1);
          const found = validation.array.some((el) => {
            if (typeof el === "object" && typeof item === "object") {
              return JSON.stringify(el) === JSON.stringify(item);
            }
            return el === item;
          });
          return createSuccessOutput(found);
        }

        case "arrayIsEmpty": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(validation.array.length === 0);
        }

        case "join": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const delimiter = arg1 !== undefined ? String(arg1) : ",";
          return createSuccessOutput(validation.array.join(delimiter));
        }

        // ============== STATISTICAL OPERATIONS (from MathService) ==============
        case "avg": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return createErrorOutput("Cannot calculate average of empty array");
          return createSuccessOutput(
            values.reduce((sum, v) => sum + v, 0) / values.length,
          );
        }

        case "sum": {
          const values = this.parseToNumericArray(value);
          return createSuccessOutput(values.reduce((sum, v) => sum + v, 0));
        }

        case "min": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return createErrorOutput("Cannot find min of empty array");
          return createSuccessOutput(Math.min(...values));
        }

        case "max": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return createErrorOutput("Cannot find max of empty array");
          return createSuccessOutput(Math.max(...values));
        }

        case "count": {
          const values = this.parseToNumericArray(value);
          return createSuccessOutput(values.length);
        }

        case "median": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return createErrorOutput("Cannot calculate median of empty array");
          const sorted = [...values].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const medianValue =
            sorted.length % 2 === 0
              ? (sorted[mid - 1] + sorted[mid]) / 2
              : sorted[mid];
          return createSuccessOutput(medianValue);
        }

        case "std": {
          const values = this.parseToNumericArray(value);
          if (values.length === 0)
            return createErrorOutput("Cannot calculate std of empty array");
          const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
          const squaredDiffs = values.map((v) => Math.pow(v - avg, 2));
          const variance =
            squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
          return createSuccessOutput(Math.sqrt(variance));
        }

        case "find": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const propertyName = String(arg1 || "");
          const matchValue = this.parseValue(arg2);
          const operatorValue = String(input.filterOperator || "===");
          const found = validation.array.find((item) => {
            if (item && typeof item === "object") {
              const itemValue = item[propertyName];
              return this.compareValues(itemValue, operatorValue, matchValue);
            }
            return false;
          });
          return createSuccessOutput(found ?? null);
        }

        case "filter": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const propertyName = String(arg1 || "");
          const matchValue = this.parseValue(arg2);
          const operatorValue = String(input.filterOperator || "===");
          const filtered = validation.array.filter((item) => {
            if (item && typeof item === "object") {
              const itemValue = item[propertyName];
              return this.compareValues(itemValue, operatorValue, matchValue);
            }
            return false;
          });
          return createSuccessOutput(filtered);
        }

        case "map": {
          const validation = this.validateArray(value);
          if (!validation.valid) return createErrorOutput(validation.error);

          const subOp = String(input.mapSubOperation || arg1 || "").toLowerCase();
          const subArg = arg2;
          const mapIndexRaw = input.mapIndex;
          const pickIndex =
            mapIndexRaw !== undefined && mapIndexRaw !== ""
              ? Number(mapIndexRaw)
              : undefined;

          const mapped = validation.array.map((item) => {
            switch (subOp) {
              case "split": {
                const delimiter =
                  subArg !== undefined && subArg !== "" ? String(subArg) : ",";
                const parts = String(item).split(delimiter);
                return pickIndex !== undefined ? (parts[pickIndex] ?? null) : parts;
              }
              case "upper":
                return String(item).toUpperCase();
              case "lower":
                return String(item).toLowerCase();
              case "trim":
                return String(item).trim();
              case "substring": {
                const start = subArg !== undefined ? Number(subArg) : 0;
                const len = pickIndex !== undefined ? pickIndex : undefined;
                return String(item).substring(
                  start,
                  len !== undefined ? start + len : undefined,
                );
              }
              case "replace": {
                const [search, replacement] = String(subArg || "")
                  .split("->")
                  .map((segment) => segment.trim());
                return String(item).replace(search || "", replacement || "");
              }
              case "getproperty": {
                if (item && typeof item === "object") {
                  return this.getNestedValue(item, String(subArg || ""));
                }
                return null;
              }
              case "tostring":
                return String(item);
              case "tonumber":
                return Number(item);
              case "round":
                return Math.round(Number(item));
              case "floor":
                return Math.floor(Number(item));
              case "ceil":
                return Math.ceil(Number(item));
              default:
                return item;
            }
          });

          return createSuccessOutput(mapped);
        }

        // ============== OBJECT OPERATIONS ==============
        case "keys": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(Object.keys(validation.object));
        }

        case "values": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(Object.values(validation.object));
        }

        case "entries": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(Object.entries(validation.object));
        }

        case "getProperty": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const path = String(arg1 || "");
          const data = this.getNestedValue(validation.object, path);
          return createSuccessOutput(data);
        }

        case "setProperty": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const obj = { ...validation.object };
          const path = String(arg1 || "");
          const newValue = this.parseValue(arg2);
          this.setNestedValue(obj, path, newValue);
          return createSuccessOutput(obj);
        }

        case "deleteProperty": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const obj = { ...validation.object };
          const path = String(arg1 || "");
          this.deleteNestedValue(obj, path);
          return createSuccessOutput(obj);
        }

        case "hasProperty": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const path = String(arg1 || "");
          const data = this.getNestedValue(validation.object, path);
          return createSuccessOutput(data !== undefined);
        }

        case "merge": {
          const validation1 = this.validateObject(value);
          if (!validation1.valid) return createErrorOutput(validation1.error);
          const validation2 = this.validateObject(arg1);
          if (!validation2.valid)
            return createErrorOutput("Second value must be an object");
          return createSuccessOutput({
            ...validation1.object,
            ...validation2.object,
          });
        }

        case "pick": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
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
          return createSuccessOutput(data);
        }

        case "omit": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          const obj = { ...validation.object };
          const keys = String(arg1 || "")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean);
          for (const key of keys) {
            delete obj[key];
          }
          return createSuccessOutput(obj);
        }

        case "objectIsEmpty": {
          const validation = this.validateObject(value);
          if (!validation.valid) return createErrorOutput(validation.error);
          return createSuccessOutput(
            Object.keys(validation.object).length === 0,
          );
        }

        default:
          return createErrorOutput(`Unsupported operator: ${operator}`);
      }
    } catch (err: any) {
      return createErrorOutput(err);
    }
  }

  // Helper: Validate and convert value to array (strict)
  private static validateArray(
    value: any,
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
    value: any,
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
    value: any,
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
    matchValue: any,
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
        return this.areValuesEqual(itemValue, matchValue);
      case "!==":
        return !this.areValuesEqual(itemValue, matchValue);
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
            this.areValuesEqual(entry, matchValue),
          );
        }
        return toStringValue(itemValue).includes(toStringValue(matchValue));
      }
      case "does_not_contain": {
        return !this.compareValues(itemValue, "contains", matchValue);
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
        return !this.compareValues(itemValue, "is_empty", matchValue);
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
        return this.areValuesEqual(itemValue, matchValue);
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
