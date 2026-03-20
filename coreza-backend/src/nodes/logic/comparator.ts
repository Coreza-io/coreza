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

import { createError } from "../../middleware/errorHandler";
import { StandardNodeOutput } from "../../types/nodeOutput";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../../utils/normalizeOutput";

export interface ComparatorInput {
  left: any;
  operator: string;
  right: any;
  dataType?:
    | "string"
    | "number"
    | "boolean"
    | "array"
    | "object"
    | "dateTime"
    | "any";
}

export type ComparatorResult = StandardNodeOutput<boolean>;

function parseValueByType(value: any, dataType: string): any {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  switch (dataType) {
    case "number": {
      const num = Number(trimmed);
      return Number.isNaN(num) ? value : num;
    }
    case "boolean":
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      return value;
    case "array":
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        try {
          return JSON.parse(trimmed);
        } catch (error) {
          return value;
        }
      }
      return value;
    case "object":
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          return JSON.parse(trimmed);
        } catch (error) {
          return value;
        }
      }
      return value;
    case "dateTime":
      if (/^\d+$/.test(trimmed)) {
        return new Date(Number.parseInt(trimmed, 10));
      }
      return value;
    case "string":
      return value;
    default:
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!Number.isNaN(num) && Number.isFinite(num)) return num;
      }
      if (
        (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
        (trimmed.startsWith("{") && trimmed.endsWith("}"))
      ) {
        try {
          return JSON.parse(trimmed);
        } catch (error) {
          return value;
        }
      }
      return value;
  }
}

function parseDateComparisonValues(
  leftValue: any,
  rightValue: any,
): StandardNodeOutput<{ leftTime: number; rightTime: number }> {
  const leftTime = new Date(leftValue).getTime();
  const rightTime = new Date(rightValue).getTime();

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return createErrorOutput("Invalid date value in comparison");
  }

  return createSuccessOutput({ leftTime, rightTime });
}

export class ComparatorService {
  static evaluate(input: ComparatorInput): ComparatorResult {
    try {
      const { operator, dataType = "any" } = input;

      switch (operator) {
        case "exists": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(left !== undefined && left !== null);
        }
        case "not_exists": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(left === undefined || left === null);
        }
        case "is_true": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            left === true || left === "true" || left === 1,
          );
        }
        case "is_false": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            left === false || left === "false" || left === 0,
          );
        }
        case "===": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(left === right);
        }
        case "!==": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(left !== right);
        }
        case ">": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Number(left) > Number(right));
        }
        case ">=": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Number(left) >= Number(right));
        }
        case "<": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Number(left) < Number(right));
        }
        case "<=": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Number(left) <= Number(right));
        }
        case "contains": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const needle = String(right).toLowerCase();

          if (Array.isArray(left)) {
            return createSuccessOutput(
              left.some((item) => String(item).toLowerCase() === needle),
            );
          }

          const leftLower = String(left).toLowerCase();
          return createSuccessOutput(leftLower.includes(needle));
        }
        case "does_not_contain": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const needle = String(right).toLowerCase();

          if (Array.isArray(left)) {
            return createSuccessOutput(
              !left.some((item) => String(item).toLowerCase() === needle),
            );
          }

          const leftLower = String(left).toLowerCase();
          return createSuccessOutput(!leftLower.includes(needle));
        }
        case "starts_with": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const leftLower = String(left).toLowerCase();
          const rightLower = String(right).toLowerCase();
          return createSuccessOutput(leftLower.startsWith(rightLower));
        }
        case "not_starts_with": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const leftLower = String(left).toLowerCase();
          const rightLower = String(right).toLowerCase();
          return createSuccessOutput(!leftLower.startsWith(rightLower));
        }
        case "ends_with": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const leftLower = String(left).toLowerCase();
          const rightLower = String(right).toLowerCase();
          return createSuccessOutput(leftLower.endsWith(rightLower));
        }
        case "not_ends_with": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const leftLower = String(left).toLowerCase();
          const rightLower = String(right).toLowerCase();
          return createSuccessOutput(!leftLower.endsWith(rightLower));
        }
        case "matches_regex": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const regex = new RegExp(String(right), "i");
          return createSuccessOutput(regex.test(String(left)));
        }
        case "not_matches_regex": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const regex = new RegExp(String(right), "i");
          return createSuccessOutput(!regex.test(String(left)));
        }
        case "is_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            left === undefined ||
              left === null ||
              left === "" ||
              (Array.isArray(left) && left.length === 0) ||
              (typeof left === "object" &&
                left !== null &&
                Object.keys(left).length === 0),
          );
        }
        case "is_not_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            left !== undefined &&
              left !== null &&
              left !== "" &&
              !(Array.isArray(left) && left.length === 0) &&
              !(typeof left === "object" &&
                left !== null &&
                Object.keys(left).length === 0),
          );
        }
        case "isNull": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(left === null);
        }
        case "is_not_null": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(left !== null);
        }
        case "date_equals": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const parsedDates = parseDateComparisonValues(left, right);

          if (!parsedDates.success || !parsedDates.data) {
            return parsedDates;
          }

          const { leftTime, rightTime } = parsedDates.data;
          return createSuccessOutput(leftTime === rightTime);
        }
        case "date_not_equals": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const parsedDates = parseDateComparisonValues(left, right);

          if (!parsedDates.success || !parsedDates.data) {
            return parsedDates;
          }

          const { leftTime, rightTime } = parsedDates.data;
          return createSuccessOutput(leftTime !== rightTime);
        }
        case "date_after": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const parsedDates = parseDateComparisonValues(left, right);

          if (!parsedDates.success || !parsedDates.data) {
            return parsedDates;
          }

          const { leftTime, rightTime } = parsedDates.data;
          return createSuccessOutput(leftTime > rightTime);
        }
        case "date_before": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          const parsedDates = parseDateComparisonValues(left, right);

          if (!parsedDates.success || !parsedDates.data) {
            return parsedDates;
          }

          const { leftTime, rightTime } = parsedDates.data;
          return createSuccessOutput(leftTime < rightTime);
        }
        case "array_contains": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Array.isArray(left) && left.includes(right));
        }
        case "array_not_contains": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Array.isArray(left) && !left.includes(right));
        }
        case "array_length_equals": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Array.isArray(left) && left.length === Number(right));
        }
        case "array_length_gt": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Array.isArray(left) && left.length > Number(right));
        }
        case "array_length_lt": {
          const left = parseValueByType(input.left, dataType);
          const right = parseValueByType(input.right, dataType);
          return createSuccessOutput(Array.isArray(left) && left.length < Number(right));
        }
        case "array_is_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(Array.isArray(left) && left.length === 0);
        }
        case "array_is_not_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(Array.isArray(left) && left.length > 0);
        }
        case "object_is_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            typeof left === "object" &&
              left !== null &&
              !Array.isArray(left) &&
              Object.keys(left).length === 0,
          );
        }
        case "object_is_not_empty": {
          const left = parseValueByType(input.left, dataType);
          return createSuccessOutput(
            typeof left === "object" &&
              left !== null &&
              !Array.isArray(left) &&
              Object.keys(left).length > 0,
          );
        }
        default:
          return createErrorOutput(
            createError(`Unsupported operator: ${operator}`, 400),
          );
      }
    } catch (error: any) {
      return createErrorOutput(error);
    }
  }

  static executeSwitch(
    cases: Array<{ condition: ComparatorInput; value: any }>,
    defaultValue?: any,
  ): StandardNodeOutput<any> {
    try {
      for (let i = 0; i < cases.length; i++) {
        const caseResult = this.evaluate(cases[i].condition);

        if (!caseResult.success) {
          return createErrorOutput(
            caseResult.error || "Switch case evaluation failed",
          );
        }

        if (caseResult.data) {
          return createSuccessOutput(cases[i].value);
        }
      }

      // No case matched, return default value
      return createSuccessOutput(defaultValue ?? null);
    } catch (error: any) {
      return createErrorOutput(error);
    }
  }
}
