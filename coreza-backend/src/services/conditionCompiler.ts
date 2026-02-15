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

import { WorkflowNode } from "../nodes/types";

export interface IndicatorStateValue {
  value: any;
  state: Record<string, any>;
}

export interface CompiledCondition {
  nodeId: string;
  evaluate: (indicatorStates: Map<string, IndicatorStateValue>) => boolean;
}

type Accessor = (indicatorStates: Map<string, IndicatorStateValue>) => any;

const NODE_REF_REGEX = /^\s*\{\{\s*\$\(\s*'([^']+)'\s*\)\s*\.json(?:\.(.+?))?\s*\}\}\s*$/;

function getByPath(value: any, path?: string): any {
  if (!path) return value;
  return path
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), value);
}

function parseLiteral(raw: any): any {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function buildAccessor(
  rawValue: any,
  indicatorLookup: Map<string, string>
): Accessor | null {
  if (typeof rawValue !== "string") {
    return () => rawValue;
  }

  const refMatch = rawValue.match(NODE_REF_REGEX);
  if (!refMatch) {
    const literal = parseLiteral(rawValue);
    return () => literal;
  }

  const [, nodeName, path] = refMatch;
  const nodeId = indicatorLookup.get(nodeName);
  if (!nodeId) return null;

  return (indicatorStates) => {
    const state = indicatorStates.get(nodeId);
    if (!state) return undefined;
    return getByPath(state.value, path);
  };
}

function compareValues(left: any, right: any, operator: string): boolean {
  switch (operator) {
    case "exists":
      return left !== undefined && left !== null;
    case "not_exists":
      return left === undefined || left === null;
    case "is_true":
      return left === true || left === "true" || left === 1;
    case "is_false":
      return left === false || left === "false" || left === 0;
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case ">":
      return Number(left) > Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<":
      return Number(left) < Number(right);
    case "<=":
      return Number(left) <= Number(right);
    case "contains":
      return Array.isArray(left)
        ? left.some((item) =>
            String(item).toLowerCase().includes(String(right).toLowerCase())
          )
        : String(left).toLowerCase().includes(String(right).toLowerCase());
    case "does_not_contain":
      return Array.isArray(left)
        ? !left.some((item) =>
            String(item).toLowerCase().includes(String(right).toLowerCase())
          )
        : !String(left).toLowerCase().includes(String(right).toLowerCase());
    case "starts_with":
      return String(left).toLowerCase().startsWith(String(right).toLowerCase());
    case "ends_with":
      return String(left).toLowerCase().endsWith(String(right).toLowerCase());
    default:
      return false;
  }
}

export function compileIfCondition(
  ifNode: WorkflowNode,
  indicatorNodes: WorkflowNode[]
): CompiledCondition | null {
  const conditions = Array.isArray(ifNode.values?.conditions)
    ? ifNode.values?.conditions
    : null;

  if (!conditions || conditions.length === 0) {
    return null;
  }

  const logicalOp: "AND" | "OR" =
    String(ifNode.values?.logicalOp || "AND").toUpperCase() === "OR"
      ? "OR"
      : "AND";

  const indicatorLookup = new Map<string, string>();
  for (const indicatorNode of indicatorNodes) {
    if (indicatorNode.name) {
      indicatorLookup.set(indicatorNode.name, indicatorNode.id);
    }
  }

  const evaluators: Array<
    (indicatorStates: Map<string, IndicatorStateValue>) => boolean
  > = [];

  for (const cond of conditions) {
    const leftAccessor = buildAccessor(cond?.left, indicatorLookup);
    const rightAccessor = buildAccessor(cond?.right, indicatorLookup);
    if (!leftAccessor || !rightAccessor) {
      return null;
    }

    const operator = String(cond?.operator || "===");
    evaluators.push((indicatorStates) =>
      compareValues(
        leftAccessor(indicatorStates),
        rightAccessor(indicatorStates),
        operator
      )
    );
  }

  return {
    nodeId: ifNode.id,
    evaluate: (indicatorStates) => {
      const results = evaluators.map((evalFn) => evalFn(indicatorStates));
      return logicalOp === "OR"
        ? results.some((result) => result)
        : results.every((result) => result);
    },
  };
}
