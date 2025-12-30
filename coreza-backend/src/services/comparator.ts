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

import { createError } from "../middleware/errorHandler";
import { Item } from "../nodes/types";
import { StandardNodeOutput } from "../types/nodeOutput";
import { createSuccessOutput, createErrorOutput } from "../utils/normalizeOutput";

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

export interface ComparatorResultData {
  result: boolean;
}

export type ComparatorResult = StandardNodeOutput<ComparatorResultData>;

function parseValueByType(value: any, dataType: string): any {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;

  switch (dataType) {
    case "number": {
      const num = parseFloat(trimmed);
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
        const num = parseFloat(trimmed);
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

const COMPARATOR_CONTEXT = { category: "control-flow", nodeName: "Comparator" };

export class ComparatorService {
  static async evaluate(input: ComparatorInput): Promise<ComparatorResult> {
    try {
      const { operator, dataType = "any" } = input;
      const left = parseValueByType(input.left, dataType);
      const right = parseValueByType(input.right, dataType);
      let result: boolean;

      switch (operator) {
        case "exists":
          result = left !== undefined && left !== null;
          break;
        case "not_exists":
          result = left === undefined || left === null;
          break;
        case "is_true":
          result = left === true || left === "true" || left === 1;
          break;
        case "is_false":
          result = left === false || left === "false" || left === 0;
          break;
        case "===":
          result = left === right;
          break;
        case "!==":
          result = left !== right;
          break;
        case ">":
          result = Number(left) > Number(right);
          break;
        case ">=":
          result = Number(left) >= Number(right);
          break;
        case "<":
          result = Number(left) < Number(right);
          break;
        case "<=":
          result = Number(left) <= Number(right);
          break;
        case "contains": {
          if (Array.isArray(left)) {
            // Array contains logic
            result = left.some(
              (item) =>
                String(item).toLowerCase() === String(right).toLowerCase()
            );
          } else {
            // String contains logic
            result = String(left)
              .toLowerCase()
              .includes(String(right).toLowerCase());
          }
          break;
        }
        case "does_not_contain": {
          if (Array.isArray(left)) {
            // Array does NOT contain right
            result = !left.some((item) =>
              String(item).toLowerCase().includes(String(right).toLowerCase())
            );
          } else {
            // String does NOT contain right
            result = !String(left)
              .toLowerCase()
              .includes(String(right).toLowerCase());
          }
          break;
        }

        case "starts_with":
          result = String(left)
            .toLowerCase()
            .startsWith(String(right).toLowerCase());
          break;
        case "not_starts_with":
          result =
            !String(left)
              .toLowerCase()
              .startsWith(String(right).toLowerCase());
          break;
        case "ends_with":
          result = String(left)
            .toLowerCase()
            .endsWith(String(right).toLowerCase());
          break;
        case "not_ends_with":
          result =
            !String(left)
              .toLowerCase()
              .endsWith(String(right).toLowerCase());
          break;
        case "matches_regex": {
          const regex = new RegExp(String(right), "i");
          result = regex.test(String(left));
          break;
        }
        case "not_matches_regex": {
          const regex = new RegExp(String(right), "i");
          result = !regex.test(String(left));
          break;
        }
        case "is_empty":
          result =
            !left ||
            left === "" ||
            (Array.isArray(left) && left.length === 0) ||
            (typeof left === "object" && Object.keys(left).length === 0);
          break;
        case "is_not_empty":
          result =
            !!left &&
            left !== "" &&
            !(Array.isArray(left) && left.length === 0) &&
            !(typeof left === "object" && Object.keys(left).length === 0);
          break;
        case "isNull":
          result = left === null;
          break;
        case "is_not_null":
          result = left !== null;
          break;
        case "date_equals":
          result = new Date(left).getTime() === new Date(right).getTime();
          break;
        case "date_not_equals":
          result = new Date(left).getTime() !== new Date(right).getTime();
          break;
        case "date_after":
          result = new Date(left).getTime() > new Date(right).getTime();
          break;
        case "date_before":
          result = new Date(left).getTime() < new Date(right).getTime();
          break;
        case "array_contains":
          result = Array.isArray(left) && left.includes(right);
          break;
        case "array_not_contains":
          result = Array.isArray(left) && !left.includes(right);
          break;
        case "array_length_equals":
          result = Array.isArray(left) && left.length === Number(right);
          break;
        case "array_length_gt":
          result = Array.isArray(left) && left.length > Number(right);
          break;
        case "array_length_lt":
          result = Array.isArray(left) && left.length < Number(right);
          break;
        case "array_is_empty":
          result = Array.isArray(left) && left.length === 0;
          break;
        case "array_is_not_empty":
          result = Array.isArray(left) && left.length > 0;
          break;
        case "object_is_empty":
          result =
            typeof left === "object" &&
            left !== null &&
            !Array.isArray(left) &&
            Object.keys(left).length === 0;
          break;
        case "object_is_not_empty":
          result =
            typeof left === "object" &&
            left !== null &&
            !Array.isArray(left) &&
            Object.keys(left).length > 0;
          break;
        default:
          throw createError(`Unsupported operator: ${operator}`, 400);
      }

      return createSuccessOutput({ result }, COMPARATOR_CONTEXT);
    } catch (error: any) {
      return createErrorOutput(error, COMPARATOR_CONTEXT);
    }
  }

  static async executeIf(
    condition: ComparatorInput
  ): Promise<ComparatorResult> {
    return this.evaluate(condition);
  }

  static async executeSwitch(
    cases: Array<{ condition: ComparatorInput; value: any }>,
    defaultValue?: any
  ): Promise<StandardNodeOutput<{ result: any; matchedCase?: number }>> {
    try {
      for (let i = 0; i < cases.length; i++) {
        const caseResult = await this.evaluate(cases[i].condition);
        if (caseResult.success && caseResult.data?.result) {
          return createSuccessOutput(
            { result: cases[i].value, matchedCase: i },
            { ...COMPARATOR_CONTEXT, nodeName: "Switch" }
          );
        }
      }

      // No case matched, return default value
      return createSuccessOutput(
        { result: defaultValue ?? null },
        { ...COMPARATOR_CONTEXT, nodeName: "Switch" }
      );
    } catch (error: any) {
      return createErrorOutput(error, { ...COMPARATOR_CONTEXT, nodeName: "Switch" });
    }
  }

  /**
   * Evaluate a single condition against each item and split into true/false arrays.
   */
  static async evaluateIfItems(
    items: Item[],
    condition: { left: string; operator: string; right: any }
  ): Promise<{ trueItems: Item[]; falseItems: Item[] }> {
    const trueItems: Item[] = [];
    const falseItems: Item[] = [];

    for (const item of items) {
      const leftValue = this.resolvePath(item, condition.left);
      const rightValue =
        typeof condition.right === "string"
          ? this.resolvePath(item, condition.right) ?? condition.right
          : condition.right;

      const evalResult = await this.evaluate({
        left: leftValue,
        operator: condition.operator,
        right: rightValue,
      });
      const result = evalResult.success && evalResult.data?.result;
      (result ? trueItems : falseItems).push(item);
    }

    return { trueItems, falseItems };
  }

  private static resolvePath(obj: any, path: string): any {
    return path.split(".").reduce((acc, key) => acc?.[key], obj);
  }
}
