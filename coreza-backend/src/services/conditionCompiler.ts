/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { WorkflowNode } from "../nodes/types";

export type RuntimeAccessor = (item: any, outputs: Map<string, any>) => any;

type CompileValueFn = (rawValue: any) => RuntimeAccessor | null;

type EvalFn = (item: any, outputs: Map<string, any>) => boolean;

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
    case "object":
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    case "dateTime":
      return /^\d+$/.test(trimmed) ? new Date(Number.parseInt(trimmed, 10)) : value;
    default:
      return value;
  }
}

function compileComparator(
  operator: string,
  leftAcc: RuntimeAccessor,
  rightAcc: RuntimeAccessor,
  dataType: string,
): EvalFn | null {
  const supportedOperators = new Set([
    "exists", "not_exists", "is_true", "is_false", "===", "!==", ">", ">=", "<", "<=",
    "contains", "does_not_contain", "starts_with", "not_starts_with", "ends_with", "not_ends_with",
    "matches_regex", "not_matches_regex", "is_empty", "is_not_empty", "date_equals", "date_not_equals",
    "date_after", "date_before", "array_contains", "array_not_contains", "array_length_equals",
    "array_length_gt", "array_length_lt", "array_is_empty", "array_is_not_empty", "isNull", "is_not_null",
    "object_is_empty", "object_is_not_empty",
  ]);

  if (!supportedOperators.has(operator)) {
    return null;
  }

  return (item, outputs) => {
    const left = parseValueByType(leftAcc(item, outputs), dataType);
    const right = parseValueByType(rightAcc(item, outputs), dataType);

    switch (operator) {
      case "exists": return left !== undefined && left !== null;
      case "not_exists": return left === undefined || left === null;
      case "is_true": return left === true || left === "true" || left === 1;
      case "is_false": return left === false || left === "false" || left === 0;
      case "===": return left === right;
      case "!==": return left !== right;
      case ">": return Number(left) > Number(right);
      case ">=": return Number(left) >= Number(right);
      case "<": return Number(left) < Number(right);
      case "<=": return Number(left) <= Number(right);
      case "contains": return Array.isArray(left)
        ? left.some((x) => String(x).toLowerCase() === String(right).toLowerCase())
        : String(left).toLowerCase().includes(String(right).toLowerCase());
      case "does_not_contain": return Array.isArray(left)
        ? !left.some((x) => String(x).toLowerCase().includes(String(right).toLowerCase()))
        : !String(left).toLowerCase().includes(String(right).toLowerCase());
      case "starts_with": return String(left).toLowerCase().startsWith(String(right).toLowerCase());
      case "not_starts_with": return !String(left).toLowerCase().startsWith(String(right).toLowerCase());
      case "ends_with": return String(left).toLowerCase().endsWith(String(right).toLowerCase());
      case "not_ends_with": return !String(left).toLowerCase().endsWith(String(right).toLowerCase());
      case "matches_regex": return new RegExp(String(right), "i").test(String(left));
      case "not_matches_regex": return !new RegExp(String(right), "i").test(String(left));
      case "is_empty": return !left || left === "" || (Array.isArray(left) && left.length === 0) || (typeof left === "object" && left && Object.keys(left).length === 0);
      case "is_not_empty": return !!left && left !== "" && !(Array.isArray(left) && left.length === 0) && !(typeof left === "object" && left && Object.keys(left).length === 0);
      case "date_equals": return new Date(left).getTime() === new Date(right).getTime();
      case "date_not_equals": return new Date(left).getTime() !== new Date(right).getTime();
      case "date_after": return new Date(left).getTime() > new Date(right).getTime();
      case "date_before": return new Date(left).getTime() < new Date(right).getTime();
      case "array_contains": return Array.isArray(left) && left.includes(right);
      case "array_not_contains": return Array.isArray(left) && !left.includes(right);
      case "array_length_equals": return Array.isArray(left) && left.length === Number(right);
      case "array_length_gt": return Array.isArray(left) && left.length > Number(right);
      case "array_length_lt": return Array.isArray(left) && left.length < Number(right);
      case "array_is_empty": return Array.isArray(left) && left.length === 0;
      case "array_is_not_empty": return Array.isArray(left) && left.length > 0;
      case "isNull": return left === null;
      case "is_not_null": return left !== null;
      case "object_is_empty": return typeof left === "object" && left != null && !Array.isArray(left) && Object.keys(left).length === 0;
      case "object_is_not_empty": return typeof left === "object" && left != null && !Array.isArray(left) && Object.keys(left).length > 0;
      default: return false;
    }
  };
}

export function compileIfConditions(
  ifNode: WorkflowNode,
  compileValue: CompileValueFn,
): ((item: any, outputs: Map<string, any>) => boolean) | null {
  const values = ifNode.values || {};
  const conditions = Array.isArray(values.conditions) ? values.conditions : [];
  const logicalOp = String(values.logicalOp || "AND").toUpperCase() === "OR" ? "OR" : "AND";

  if (conditions.length === 0) {
    const left = compileValue(values.value1);
    const right = compileValue(values.value2);
    if (!left || !right) return null;
    const op = String(values.operation || "===");
    const fn = compileComparator(op, left, right, String(values.dataType || "any"));
    return fn || null;
  }

  const compiled = conditions.map((cond: any) => {
    const left = compileValue(cond.left);
    const right = compileValue(cond.right);
    if (!left || !right) return null;
    return compileComparator(String(cond.operator || "==="), left, right, String(cond.dataType || "any"));
  });

  if (compiled.some((c) => c == null)) return null;

  return (item: any, outputs: Map<string, any>) => {
    const checks = compiled.map((fn) => (fn as EvalFn)(item, outputs));
    return logicalOp === "OR" ? checks.some(Boolean) : checks.every(Boolean);
  };
}

export function compileSwitchConditions(
  switchNode: WorkflowNode,
  compileValue: CompileValueFn,
): ((item: any, outputs: Map<string, any>) => string) | null {
  const values = switchNode.values || {};
  const cases = Array.isArray(values.cases) ? values.cases : [];
  const defaultCase = String(values.defaultCase || "fallback");

  const compiledCases = cases.map((c: any, idx: number) => {
    const left = compileValue(c.left !== undefined ? c.left : values.inputValue ?? values.value);
    const right = compileValue(c.right ?? c.caseValue);
    if (!left || !right) return null;
    const test = compileComparator(String(c.operator || "==="), left, right, String(c.dataType || "any"));
    if (!test) return null;
    return {
      test,
      value: String(c.outputName || c.caseName || c.caseValue || `case${idx + 1}`),
    };
  });

  if (compiledCases.some((c) => c == null)) return null;

  return (item: any, outputs: Map<string, any>) => {
    for (const c of compiledCases) {
      const current = c as { test: EvalFn; value: string };
      if (current.test(item, outputs)) return current.value;
    }
    return defaultCase;
  };
}
