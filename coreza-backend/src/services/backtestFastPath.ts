/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { ComputeService } from "./compute";
import { IndicatorService } from "./indicators";
import { SimBroker, type Bar } from "./simBroker";
import { getRedisCache } from "../config/redis";
import {
  buildStoreKey,
  parseMembers,
  parseScoreMembers,
  parseStoredValue,
} from "../utils/store";
import { getValueByPath } from "../utils/resolveReferences";
import {
  compileIfConditions,
  compileSwitchConditions,
  type RuntimeAccessor,
} from "./conditionCompiler";

type NodeOutputs = Map<string, any>;
type ParamAccessor = (item: any, outputs: NodeOutputs) => any;

type CompiledStep = {
  nodeId: string;
  nodeName: string;
  resolveParams: ParamAccessor;
  execute: (params: any) => any;
  condition?: (outputs: NodeOutputs) => boolean;
};

type StoreReadResultMapper = (value: any) => any;
type StorePipelineOp =
  | "xadd"
  | "xrange"
  | "set"
  | "lpush"
  | "rpush"
  | "hset"
  | "sadd"
  | "zadd"
  | "get";

export type CompiledAsyncLoop = {
  steps: CompiledStep[];
  lastNodeId: string;
  redis: ReturnType<typeof getRedisCache>;
  pipelineChunkSize: number;
};

export type CompiledLoop = {
  steps: CompiledStep[];
  lastNodeId: string;
};

const FAST_PATH_NODE_WHITELIST = new Set([
  "Compute",
  "If",
  "Switch",
  "Edit Fields",
  "RSI",
  "EMA",
  "SMA",
  "MACD",
  "BB",
  "Stoch",
  "ADX",
  "OBV",
  "VWAP",
  "Ichimoku",
  "VolumeOscillator",
  "SupportResistance",
  "BacktestTrade",
  "BacktestSnapshot",
]);

export function canUseFastPath(bodyNodes: WorkflowNode[]): boolean {
  return (
    bodyNodes.length > 0 &&
    bodyNodes.every((n) =>
      FAST_PATH_NODE_WHITELIST.has(String(n.name || n.node_type)),
    )
  );
}

const ASYNC_FAST_PATH_NODE_WHITELIST = new Set([
  ...FAST_PATH_NODE_WHITELIST,
  "Store",
]);

const STORE_PIPELINED_OPERATIONS = new Set([
  "xrange",
  "xadd",
  "set",
  "lpush",
  "rpush",
  "hset",
  "sadd",
  "zadd",
  "get",
]);

export function canUseAsyncFastPath(bodyNodes: WorkflowNode[]): boolean {
  return (
    bodyNodes.length > 0 &&
    bodyNodes.every((n) =>
      ASYNC_FAST_PATH_NODE_WHITELIST.has(String(n.name || n.node_type)),
    )
  );
}

function pickJsonSource(d: any): any {
  if (d == null) return d;
  const candidates = [
    d.json,
    d.output?.json,
    d.output,
    d.input?.json,
    d.input,
    d.data?.output?.json,
    d.data?.output,
    d.data?.input?.json,
    d.data?.input,
    d,
  ];
  for (const c of candidates) if (c !== undefined) return c;
  return d;
}

function resolveNodeKey(
  nodeName: string,
  allNodeData?: Record<string, any>,
  nodes?: Array<{ id: string; data?: any; label?: string; name?: string }>,
): string | undefined {
  if (!nodeName) return undefined;
  if (allNodeData?.[nodeName] !== undefined) return nodeName;
  const candidate = nodes?.find(
    (n) =>
      n.id === nodeName ||
      (n as any).label === nodeName ||
      (n as any).name === nodeName ||
      n.data?.title === nodeName ||
      n.data?.name === nodeName ||
      n.data?.label === nodeName ||
      (n.data as any)?.displayName === nodeName,
  );
  if (candidate && allNodeData?.[candidate.id] !== undefined)
    return candidate.id;
  return candidate?.id;
}

function parseMaybeNumber(value: string): string | number {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return value;
}

function createStaticAccessor(value: any): ParamAccessor {
  return () => value;
}

function compileTemplateExpression(
  expression: string,
  bodyNodeIds: Set<string>,
  allNodes: WorkflowNode[],
  allResults: Record<string, any>,
): ParamAccessor | null {
  const trimmed = expression.trim();
  const jsonMatch = trimmed.match(/^\$json(?:\.(.*))?$/);
  if (jsonMatch) {
    const path = (jsonMatch[1] || "").trim();
    return (item: any) => {
      const target = pickJsonSource(item);
      return path ? getValueByPath(target, path) : target;
    };
  }

  const jqueryRefMatch = trimmed.match(
    /^\$\(\s*'([^']+)'\s*\)\.json(?:\.(.*))?$/,
  );
  const nodeRefMatch = trimmed.match(
    /^\$node\[\s*(?:"([^"]+)"|'([^']+)')\s*\]\.json(?:\.(.*))?$/,
  );

  if (!jqueryRefMatch && !nodeRefMatch) return null;

  const nodeName = jqueryRefMatch
    ? (jqueryRefMatch[1] || "").trim()
    : (nodeRefMatch?.[1] || nodeRefMatch?.[2] || "").trim();
  const path = jqueryRefMatch
    ? (jqueryRefMatch[2] || "").trim()
    : (nodeRefMatch?.[3] || "").trim();
  const resolvedId =
    resolveNodeKey(nodeName, allResults, allNodes as any) || nodeName;

  if (bodyNodeIds.has(resolvedId)) {
    return (_item: any, outputs: NodeOutputs) => {
      const target = pickJsonSource(outputs.get(resolvedId));
      return path ? getValueByPath(target, path) : target;
    };
  }

  if (allResults[resolvedId] === undefined) return null;
  const constSource = pickJsonSource(allResults[resolvedId]);
  const constValue = path ? getValueByPath(constSource, path) : constSource;
  return createStaticAccessor(constValue);
}

export function compileParamValue(
  rawValue: any,
  bodyNodeIds: Set<string>,
  allNodes: WorkflowNode[],
  allResults: Record<string, any>,
): ParamAccessor | null {
  if (
    rawValue == null ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean"
  ) {
    return createStaticAccessor(rawValue);
  }

  if (Array.isArray(rawValue)) {
    const compiledItems = rawValue.map((v) =>
      compileParamValue(v, bodyNodeIds, allNodes, allResults),
    );
    if (compiledItems.some((v) => v == null)) return null;
    return (item: any, outputs: NodeOutputs) =>
      compiledItems.map((acc) => (acc as ParamAccessor)(item, outputs));
  }

  if (typeof rawValue === "object") {
    const compiledEntries = Object.entries(rawValue).map(
      ([k, v]) =>
        [k, compileParamValue(v, bodyNodeIds, allNodes, allResults)] as const,
    );
    if (compiledEntries.some(([, v]) => v == null)) return null;
    return (item: any, outputs: NodeOutputs) =>
      Object.fromEntries(
        compiledEntries.map(([k, acc]) => [
          k,
          (acc as ParamAccessor)(item, outputs),
        ]),
      );
  }

  if (typeof rawValue !== "string") {
    return createStaticAccessor(rawValue);
  }

  if (!rawValue.includes("{{")) {
    return createStaticAccessor(parseMaybeNumber(rawValue));
  }

  const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
  const matches = [...rawValue.matchAll(regex)];
  if (matches.length === 0) return createStaticAccessor(rawValue);

  if (matches.length === 1 && matches[0][0].trim() === rawValue.trim()) {
    return compileTemplateExpression(
      matches[0][1],
      bodyNodeIds,
      allNodes,
      allResults,
    );
  }

  const segments: Array<string | ParamAccessor> = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > cursor) segments.push(rawValue.slice(cursor, start));
    const compiled = compileTemplateExpression(
      match[1],
      bodyNodeIds,
      allNodes,
      allResults,
    );
    if (!compiled) return null;
    segments.push(compiled);
    cursor = end;
  }
  if (cursor < rawValue.length) segments.push(rawValue.slice(cursor));

  return (item: any, outputs: NodeOutputs) =>
    segments
      .map((seg) => (typeof seg === "string" ? seg : seg(item, outputs)))
      .join("");
}

function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] | null {
  const ids = new Set(nodes.map((n) => n.id));
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    if (!ids.has(edge.target)) continue;
    if (!ids.has(edge.source)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    const list = outgoing.get(edge.source) || [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  const queue = nodes.filter((n) => (indegree.get(n.id) || 0) === 0);
  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const node = queue.shift() as WorkflowNode;
    ordered.push(node);
    for (const target of outgoing.get(node.id) || []) {
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if ((indegree.get(target) || 0) === 0) {
        const targetNode = nodes.find((n) => n.id === target);
        if (targetNode) queue.push(targetNode);
      }
    }
  }

  return ordered.length === nodes.length ? ordered : null;
}

function compileFieldStep(params: any): any {
  const fields = Array.isArray(params.fields) ? params.fields : [];
  const persistent = !!params.persistent;
  const result: Record<string, any> = {};

  for (const field of fields) {
    const fieldName = field?.left;
    if (!fieldName) continue;
    const operator = field?.operator;
    const value = field?.right;

    switch (operator) {
      case "set":
        result[fieldName] = value;
        break;
      case "copy":
        if (value in params) {
          result[fieldName] = params[value];
        }
        break;
      case "remove":
        delete result[fieldName];
        break;
      case "increment":
        result[fieldName] = Number(result[fieldName] || 0) + Number(value || 1);
        break;
      case "decrement":
        result[fieldName] = Number(result[fieldName] || 0) - Number(value || 1);
        break;
      default:
        return null;
    }
  }

  if (persistent) {
    Object.assign(result, params);
  }

  return result;
}

function parseBar(raw: any): Bar | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const open = Number(raw.open ?? raw.o);
  const high = Number(raw.high ?? raw.h);
  const low = Number(raw.low ?? raw.l);
  const close = Number(raw.close ?? raw.c ?? raw.price);
  const volume = Number(raw.volume ?? raw.v ?? 0);
  const timestamp = raw.timestamp ?? raw.t;

  if (![open, high, low, close].every(Number.isFinite)) {
    return null;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  } as Bar;
}

export function compileFastPath(
  bodyNodes: WorkflowNode[],
  bodyEdges: WorkflowEdge[],
  _loopNode: WorkflowNode,
  context: any,
): CompiledLoop | null {
  const ordered = topologicalSort(bodyNodes, bodyEdges);
  if (!ordered) return null;

  const allNodes = Array.isArray(context?.nodes) ? context.nodes : bodyNodes;
  const allResults = context?.getAllNodeResults
    ? context.getAllNodeResults()
    : {};
  const bodyNodeIds = new Set(bodyNodes.map((n) => n.id));
  const bodyNodeById = new Map(bodyNodes.map((n) => [n.id, n] as const));
  const incomingByNode = new Map<string, WorkflowEdge[]>();
  const outgoingByNode = new Map<string, WorkflowEdge[]>();

  for (const edge of bodyEdges) {
    const inList = incomingByNode.get(edge.target) || [];
    inList.push(edge);
    incomingByNode.set(edge.target, inList);
    const outList = outgoingByNode.get(edge.source) || [];
    outList.push(edge);
    outgoingByNode.set(edge.source, outList);
  }

  const indicatorStates = new Map<
    string,
    {
      updater: ReturnType<typeof IndicatorService.createIncrementalUpdater>;
      state: Record<string, any> | null;
    }
  >();
  const brokers = new Map<string, SimBroker>();
  const steps: CompiledStep[] = [];

  for (const node of ordered) {
    const values = node.values || {};
    const compiledEntries: Array<[string, ParamAccessor]> = [];

    for (const [k, v] of Object.entries(values)) {
      if (k === "credential_id") continue;
      const compiled = compileParamValue(v, bodyNodeIds, allNodes, allResults);
      if (!compiled) return null;
      compiledEntries.push([k, compiled]);
    }

    const resolveParams: ParamAccessor = (item, outputs) =>
      Object.fromEntries(
        compiledEntries.map(([k, acc]) => [k, acc(item, outputs)]),
      );

    const nodeName = String(node.name || node.node_type);
    let execute: (params: any) => any;

    if (nodeName === "Compute") {
      execute = (params) =>
        ComputeService.compute(params, { skipTimestamp: true }).data;
    } else if (nodeName === "If") {
      const condition = compileIfConditions(
        node,
        (raw): RuntimeAccessor | null =>
          compileParamValue(raw, bodyNodeIds, allNodes, allResults),
      );
      if (!condition) return null;
      execute = (params) => ({
        true: condition(params.item, params.outputs),
        false: !condition(params.item, params.outputs),
      });
    } else if (nodeName === "Switch") {
      const selector = compileSwitchConditions(
        node,
        (raw): RuntimeAccessor | null =>
          compileParamValue(raw, bodyNodeIds, allNodes, allResults),
      );
      if (!selector) return null;
      execute = (params) => ({ result: selector(params.item, params.outputs) });
    } else if (nodeName === "Edit Fields") {
      execute = (params) => compileFieldStep(params);
    } else if (
      FAST_PATH_NODE_WHITELIST.has(nodeName) &&
      ![
        "Compute",
        "If",
        "Switch",
        "Edit Fields",
        "BacktestTrade",
        "BacktestSnapshot",
      ].includes(nodeName)
    ) {
      execute = (params) => {
        const key = node.id;
        let entry = indicatorStates.get(key);
        if (!entry) {
          const updater = IndicatorService.createIncrementalUpdater(
            nodeName,
            params,
          );
          entry = { updater, state: null };
          indicatorStates.set(key, entry);
        }
        const bar =
          params.current_bar ||
          params.bar ||
          params.candle ||
          params.input ||
          params;
        if (!entry.state) {
          const warm = entry.updater.warmUp([]);
          entry.state = warm.internalState;
        }
        const updated = entry.updater.update(entry.state, bar);
        entry.state = updated.internalState;
        return updated.value;
      };
    } else if (nodeName === "BacktestTrade") {
      execute = (params) => {
        const backtestId = String(params.backtest_id || "");
        if (!backtestId) return null;
        let broker = brokers.get(backtestId);
        if (!broker) {
          broker = new SimBroker(backtestId);
          broker.initializePortfolio();
          brokers.set(backtestId, broker);
        }

        const currentBar = parseBar(params.current_bar || params);
        const symbol = String(params.symbol || "");
        if (currentBar && symbol) broker.onBar(symbol, currentBar);

        const orderResult = broker.placeOrder({
          symbol,
          side: params.side as "buy" | "sell",
          type: (params.order_type || "market") as
            | "market"
            | "limit"
            | "stop"
            | "stop_limit",
          quantity: Number(params.quantity),
          limitPrice:
            params.limit_price != null ? Number(params.limit_price) : undefined,
          stopPrice:
            params.stop_price != null ? Number(params.stop_price) : undefined,
        });

        return {
          order_id: orderResult.orderId,
          order_status: orderResult.status,
          cash: broker.getCash(),
          positions: broker.getPositions(),
          pending_orders: broker.getPendingOrders().length,
        };
      };
    } else if (nodeName === "BacktestSnapshot") {
      execute = (params) => {
        const backtestId = String(params.backtest_id || "");
        if (!backtestId) return null;
        let broker = brokers.get(backtestId);
        if (!broker) {
          broker = new SimBroker(backtestId);
          broker.initializePortfolio();
          brokers.set(backtestId, broker);
        }
        const currentBar = parseBar(params.current_bar || params);
        if (currentBar && params.symbol) {
          broker.onBar(String(params.symbol), currentBar);
        }
        const prices =
          typeof params.prices === "object" && params.prices
            ? { ...params.prices }
            : {};
        if (currentBar) {
          prices[String(params.symbol || "UNKNOWN")] = currentBar.close;
        }
        return broker.recordSnapshot(
          String(params.timestamp || new Date().toISOString()),
          prices,
        );
      };
    } else {
      return null;
    }

    const incoming = incomingByNode.get(node.id) || [];
    const condition = incoming.length
      ? (outputs: NodeOutputs) =>
          incoming.every((edge) => {
            if (!bodyNodeIds.has(edge.source)) return true;
            const sourceNode = bodyNodeById.get(edge.source);
            const sourceName = String(
              sourceNode?.name || sourceNode?.node_type || "",
            );
            const sourceOutput = outputs.get(edge.source);
            if (sourceName === "If") {
              if (edge.sourceHandle === "true")
                return Boolean(sourceOutput?.true);
              if (edge.sourceHandle === "false")
                return Boolean(sourceOutput?.false);
            }
            if (sourceName === "Switch" && edge.sourceHandle) {
              return String(sourceOutput?.result) === String(edge.sourceHandle);
            }
            return sourceOutput !== undefined;
          })
      : undefined;

    steps.push({
      nodeId: node.id,
      nodeName,
      resolveParams: (item, outputs) => {
        const params = resolveParams(item, outputs);
        if (nodeName === "If" || nodeName === "Switch") {
          return { ...params, item, outputs };
        }
        return params;
      },
      execute,
      condition,
    });
  }

  const lastNode =
    [...ordered].reverse().find((n) => {
      const outgoing = outgoingByNode.get(n.id) || [];
      return outgoing.every((e) => !bodyNodeIds.has(e.target));
    }) || ordered[ordered.length - 1];

  return {
    steps,
    lastNodeId: lastNode.id,
  };
}

function normalizeStoreValue(value: any): any {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function compileStoreStep(
  node: WorkflowNode,
  resolveParams: ParamAccessor,
  context: any,
): CompiledStep | null {
  const redis = getRedisCache();
  const userId = String(context?.userId || "system");
  const defaultWorkflowId = String(context?.workflowId || "");
  const staticOutputs = new Map<string, any>();

  let staticResolvedParams: Record<string, any> | null = null;
  try {
    const maybeStatic = resolveParams(undefined, staticOutputs);
    if (maybeStatic && typeof maybeStatic === "object") {
      staticResolvedParams = maybeStatic;
    }
  } catch {
    staticResolvedParams = null;
  }

  const staticOperation = String(
    staticResolvedParams?.operation || node.values?.operation || "xadd",
  ).toLowerCase();
  if (!STORE_PIPELINED_OPERATIONS.has(staticOperation)) {
    return null;
  }

  const staticWorkflowId = String(
    staticResolvedParams?.workflow_id ||
      staticResolvedParams?.workflowId ||
      defaultWorkflowId,
  );
  const staticVariableName = String(
    staticResolvedParams?.variableNameManual ||
      staticResolvedParams?.variableNameSelect ||
      staticResolvedParams?.variableName ||
      "",
  );
  const staticStoreKey =
    staticWorkflowId && staticVariableName
      ? buildStoreKey(userId, staticWorkflowId, staticVariableName)
      : null;

  return {
    nodeId: node.id,
    nodeName: String(node.name || node.node_type),
    resolveParams,
    execute: (params) => {
      const operation = String(
        params.operation || staticOperation || "xadd",
      ).toLowerCase();
      if (!STORE_PIPELINED_OPERATIONS.has(operation)) {
        throw new Error(
          `Store operation '${operation}' is not supported by async fast path`,
        );
      }

      const workflowId = String(
        params.workflow_id || params.workflowId || defaultWorkflowId,
      );
      const variableName = String(
        params.variableNameManual ||
          params.variableNameSelect ||
          params.variableName ||
          "",
      );

      if (!workflowId || !variableName) {
        throw new Error(
          "Store fast path requires workflow_id/workflowId and variableName",
        );
      }

      const key =
        staticStoreKey || buildStoreKey(userId, workflowId, variableName);
      const ttl = Number(params.ttl || 0);
      const baseOutput = {
        operation,
        variableName,
      };

      if (operation === "xadd") {
        const resolved = normalizeStoreValue(params.value);
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: ["*", "data", JSON.stringify(resolved)],
          output: { ...baseOutput, message: "Stream entry added" },
        } as const;
      }

      if (operation === "set") {
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: [JSON.stringify(params.value)],
          output: { ...baseOutput, message: "Value saved" },
        } as const;
      }

      if (operation === "lpush" || operation === "rpush") {
        const value =
          typeof params.value === "string"
            ? params.value
            : JSON.stringify(params.value);
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: [value],
          output: {
            ...baseOutput,
            message: `Value pushed ${operation === "lpush" ? "left" : "right"}`,
          },
        } as const;
      }

      if (operation === "hset") {
        const field = params.field;
        if (!field) {
          throw new Error("Store hset requires field");
        }
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: [String(field), JSON.stringify(params.value)],
          output: { ...baseOutput, message: "Hash field set", field },
        } as const;
      }

      if (operation === "sadd") {
        const members = Array.isArray(params.members)
          ? params.members
          : parseMembers(String(params.members || ""));
        if (!members.length) {
          throw new Error("Store sadd requires members");
        }
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: members,
          output: { ...baseOutput, message: "Members added" },
        } as const;
      }

      if (operation === "zadd") {
        const scoreMembers = Array.isArray(params.scoreMembers)
          ? params.scoreMembers
          : parseScoreMembers(String(params.scoreMembers || ""));
        if (!scoreMembers.length) {
          throw new Error("Store zadd requires scoreMembers");
        }
        return {
          redis,
          kind: "store_pipeline",
          op: operation,
          key,
          ttl,
          args: scoreMembers,
          output: { ...baseOutput, message: "Sorted set members added" },
        } as const;
      }

      return {
        redis,
        kind: "store_pipeline",
        op: "get",
        key,
        ttl: 0,
        args: [],
        output: baseOutput,
        mapResult: parseStoredValue,
      } as const;
    },
  };
}

export function compileAsyncFastPath(
  bodyNodes: WorkflowNode[],
  bodyEdges: WorkflowEdge[],
  loopNode: WorkflowNode,
  context: any,
): CompiledAsyncLoop | null {
  if (!canUseAsyncFastPath(bodyNodes)) return null;

  const compiled = compileFastPath(bodyNodes, bodyEdges, loopNode, context);
  if (compiled) {
    return {
      ...compiled,
      redis: getRedisCache(),
      pipelineChunkSize: 500,
    };
  }

  const ordered = topologicalSort(bodyNodes, bodyEdges);
  if (!ordered) return null;

  const allNodes = Array.isArray(context?.nodes) ? context.nodes : bodyNodes;
  const allResults = context?.getAllNodeResults
    ? context.getAllNodeResults()
    : {};
  const bodyNodeIds = new Set(bodyNodes.map((n) => n.id));
  const incomingByNode = new Map<string, WorkflowEdge[]>();
  const outgoingByNode = new Map<string, WorkflowEdge[]>();
  const bodyNodeById = new Map(bodyNodes.map((n) => [n.id, n] as const));

  for (const edge of bodyEdges) {
    const inList = incomingByNode.get(edge.target) || [];
    inList.push(edge);
    incomingByNode.set(edge.target, inList);
    const outList = outgoingByNode.get(edge.source) || [];
    outList.push(edge);
    outgoingByNode.set(edge.source, outList);
  }

  const indicatorStates = new Map<
    string,
    {
      updater: ReturnType<typeof IndicatorService.createIncrementalUpdater>;
      state: Record<string, any> | null;
    }
  >();
  const brokers = new Map<string, SimBroker>();
  const steps: CompiledStep[] = [];

  for (const node of ordered) {
    const values = node.values || {};
    const compiledEntries: Array<[string, ParamAccessor]> = [];
    for (const [k, v] of Object.entries(values)) {
      if (k === "credential_id") continue;
      const compiledValue = compileParamValue(
        v,
        bodyNodeIds,
        allNodes,
        allResults,
      );
      if (!compiledValue) return null;
      compiledEntries.push([k, compiledValue]);
    }

    const resolveParams: ParamAccessor = (item, outputs) =>
      Object.fromEntries(
        compiledEntries.map(([k, acc]) => [k, acc(item, outputs)]),
      );

    const nodeName = String(node.name || node.node_type);
    let step: CompiledStep | null = null;

    if (nodeName === "Store") {
      step = compileStoreStep(node, resolveParams, context);
    } else {
      let execute: (params: any) => any;

      if (nodeName === "Compute") {
        execute = (params) =>
          ComputeService.compute(params, { skipTimestamp: true }).data;
      } else if (nodeName === "If") {
        const condition = compileIfConditions(
          node,
          (raw): RuntimeAccessor | null =>
            compileParamValue(raw, bodyNodeIds, allNodes, allResults),
        );
        if (!condition) return null;
        execute = (params) => ({
          true: condition(params.item, params.outputs),
          false: !condition(params.item, params.outputs),
        });
      } else if (nodeName === "Switch") {
        const selector = compileSwitchConditions(
          node,
          (raw): RuntimeAccessor | null =>
            compileParamValue(raw, bodyNodeIds, allNodes, allResults),
        );
        if (!selector) return null;
        execute = (params) => ({
          result: selector(params.item, params.outputs),
        });
      } else if (nodeName === "Edit Fields") {
        execute = (params) => compileFieldStep(params);
      } else if (
        FAST_PATH_NODE_WHITELIST.has(nodeName) &&
        ![
          "Compute",
          "If",
          "Switch",
          "Edit Fields",
          "BacktestTrade",
          "BacktestSnapshot",
        ].includes(nodeName)
      ) {
        execute = (params) => {
          const key = node.id;
          let entry = indicatorStates.get(key);
          if (!entry) {
            const updater = IndicatorService.createIncrementalUpdater(
              nodeName,
              params,
            );
            entry = { updater, state: null };
            indicatorStates.set(key, entry);
          }
          const bar =
            params.current_bar ||
            params.bar ||
            params.candle ||
            params.input ||
            params;
          if (!entry.state) {
            const warm = entry.updater.warmUp([]);
            entry.state = warm.internalState;
          }
          const updated = entry.updater.update(entry.state, bar);
          entry.state = updated.internalState;
          return updated.value;
        };
      } else if (nodeName === "BacktestTrade") {
        execute = (params) => {
          const backtestId = String(params.backtest_id || "");
          if (!backtestId) return null;
          let broker = brokers.get(backtestId);
          if (!broker) {
            broker = new SimBroker(backtestId);
            broker.initializePortfolio();
            brokers.set(backtestId, broker);
          }

          const currentBar = parseBar(params.current_bar || params);
          const symbol = String(params.symbol || "");
          if (currentBar && symbol) broker.onBar(symbol, currentBar);

          const orderResult = broker.placeOrder({
            symbol,
            side: params.side as "buy" | "sell",
            type: (params.order_type || "market") as
              | "market"
              | "limit"
              | "stop"
              | "stop_limit",
            quantity: Number(params.quantity),
            limitPrice:
              params.limit_price != null
                ? Number(params.limit_price)
                : undefined,
            stopPrice:
              params.stop_price != null ? Number(params.stop_price) : undefined,
          });

          return {
            order_id: orderResult.orderId,
            order_status: orderResult.status,
            cash: broker.getCash(),
            positions: broker.getPositions(),
            pending_orders: broker.getPendingOrders().length,
          };
        };
      } else if (nodeName === "BacktestSnapshot") {
        execute = (params) => {
          const backtestId = String(params.backtest_id || "");
          if (!backtestId) return null;
          let broker = brokers.get(backtestId);
          if (!broker) {
            broker = new SimBroker(backtestId);
            broker.initializePortfolio();
            brokers.set(backtestId, broker);
          }
          const currentBar = parseBar(params.current_bar || params);
          if (currentBar && params.symbol) {
            broker.onBar(String(params.symbol), currentBar);
          }
          const prices =
            typeof params.prices === "object" && params.prices
              ? { ...params.prices }
              : {};
          if (currentBar) {
            prices[String(params.symbol || "UNKNOWN")] = currentBar.close;
          }
          return broker.recordSnapshot(
            String(params.timestamp || new Date().toISOString()),
            prices,
          );
        };
      } else {
        return null;
      }

      step = {
        nodeId: node.id,
        nodeName,
        resolveParams: (item, outputs) => {
          const params = resolveParams(item, outputs);
          if (nodeName === "If" || nodeName === "Switch") {
            return { ...params, item, outputs };
          }
          return params;
        },
        execute,
      };
    }

    if (!step) return null;

    const incoming = incomingByNode.get(node.id) || [];
    const condition = incoming.length
      ? (outputs: NodeOutputs) =>
          incoming.every((edge) => {
            if (!bodyNodeIds.has(edge.source)) return true;
            const sourceNode = bodyNodeById.get(edge.source);
            const sourceName = String(
              sourceNode?.name || sourceNode?.node_type || "",
            );
            const sourceOutput = outputs.get(edge.source);
            if (sourceName === "If") {
              if (edge.sourceHandle === "true")
                return Boolean(sourceOutput?.true);
              if (edge.sourceHandle === "false")
                return Boolean(sourceOutput?.false);
            }
            if (sourceName === "Switch" && edge.sourceHandle) {
              return String(sourceOutput?.result) === String(edge.sourceHandle);
            }
            return sourceOutput !== undefined;
          })
      : undefined;

    steps.push({
      ...step,
      condition,
    });
  }

  const lastNode =
    [...ordered].reverse().find((n) => {
      const outgoing = outgoingByNode.get(n.id) || [];
      return outgoing.every((e) => !bodyNodeIds.has(e.target));
    }) || ordered[ordered.length - 1];

  return {
    steps,
    lastNodeId: lastNode.id,
    redis: getRedisCache(),
    pipelineChunkSize: 500,
  };
}

export function executeFastPath(items: any[], compiled: CompiledLoop): any[] {
  const start = Date.now();
  const results: any[] = [];
  const nodeOutputs = new Map<string, any>();

  for (let i = 0; i < items.length; i++) {
    nodeOutputs.clear();
    const item = items[i];
    for (const step of compiled.steps) {
      if (step.condition && !step.condition(nodeOutputs)) continue;
      const params = step.resolveParams(item, nodeOutputs);
      const output = step.execute(params);
      nodeOutputs.set(step.nodeId, output);
    }
    results.push(nodeOutputs.get(compiled.lastNodeId));
  }

  const elapsed = Date.now() - start;
  const rate = elapsed > 0 ? (items.length / elapsed) * 1000 : 0;
  console.log(
    `[FastPath] ${items.length} items in ${elapsed.toFixed(1)}ms (${rate.toFixed(0)} items/sec)`,
  );

  return results;
}

export async function executeAsyncFastPath(
  items: any[],
  compiled: CompiledAsyncLoop,
): Promise<any[]> {
  const start = Date.now();
  const results: any[] = [];
  const nodeOutputs = new Map<string, any>();
  const chunkSize = Math.max(1, Number(compiled.pipelineChunkSize) || 500);

  for (let chunkStart = 0; chunkStart < items.length; chunkStart += chunkSize) {
    const chunk = items.slice(chunkStart, chunkStart + chunkSize);
    const pipeline = compiled.redis.pipeline();
    const readOps: Array<{
      nodeId: string;
      itemIndex: number;
      commandIndex: number;
      mapResult?: StoreReadResultMapper;
    }> = [];
    const chunkNodeOutputs: NodeOutputs[] = [];
    const ttlByKey = new Map<string, number>();
    let queuedCommandCount = 0;

    for (const item of chunk) {
      nodeOutputs.clear();
      for (const step of compiled.steps) {
        if (step.condition && !step.condition(nodeOutputs)) continue;
        const params = step.resolveParams(item, nodeOutputs);
        const output = step.execute(params);

        if (output?.kind === "store_pipeline") {
          const op = output.op as StorePipelineOp;
          const key = String(output.key || "");
          const args = Array.isArray(output.args) ? output.args : [];
          if (op === "xadd") {
            pipeline.xadd(key, ...(args as [string, string, string]));
            queuedCommandCount += 1;
          } else if (op === "set") {
            pipeline.set(key, ...(args as [string]));
            queuedCommandCount += 1;
          } else if (op === "lpush") {
            pipeline.lpush(key, ...(args as string[]));
            queuedCommandCount += 1;
          } else if (op === "rpush") {
            pipeline.rpush(key, ...(args as string[]));
            queuedCommandCount += 1;
          } else if (op === "hset") {
            pipeline.hset(key, ...(args as [string, string]));
            queuedCommandCount += 1;
          } else if (op === "sadd") {
            pipeline.sadd(key, ...(args as string[]));
            queuedCommandCount += 1;
          } else if (op === "zadd") {
            pipeline.zadd(key, ...(args as (string | number)[]));
            queuedCommandCount += 1;
          } else if (op === "get") {
            pipeline.get(key);
            const commandIndex = queuedCommandCount;
            queuedCommandCount += 1;
            readOps.push({
              mapResult: output.mapResult,
              nodeId: step.nodeId,
              itemIndex: chunkNodeOutputs.length,
              commandIndex,
            });
          }

          if (output.ttl && output.ttl > 0) {
            ttlByKey.set(
              key,
              Math.max(ttlByKey.get(key) || 0, Number(output.ttl)),
            );
          }

          nodeOutputs.set(step.nodeId, output.output);
        } else {
          nodeOutputs.set(step.nodeId, output);
        }
      }

      chunkNodeOutputs.push(new Map(nodeOutputs));
      results.push(nodeOutputs.get(compiled.lastNodeId));
    }

    const pipelineResult = await pipeline.exec();
    if (!pipelineResult) {
      throw new Error("Redis pipeline execution failed");
    }

    const readByCommandIndex = new Map(
      readOps.map((readRef) => [readRef.commandIndex, readRef]),
    );
    for (const [idx, [error, value]] of pipelineResult.entries()) {
      if (error) {
        throw error;
      }

      const readRef = readByCommandIndex.get(idx);
      if (!readRef) continue;

      const mappedValue = readRef.mapResult ? readRef.mapResult(value) : value;
      const targetOutputs = chunkNodeOutputs[readRef.itemIndex];
      targetOutputs?.set(readRef.nodeId, {
        operation: "get",
        value: mappedValue,
      });
      const resultIndex = chunkStart + readRef.itemIndex;
      results[resultIndex] = targetOutputs?.get(compiled.lastNodeId);
    }

    const isLastChunk = chunkStart + chunkSize >= items.length;
    if (isLastChunk && ttlByKey.size > 0) {
      await Promise.all(
        [...ttlByKey.entries()].map(([key, ttl]) =>
          compiled.redis.expire(key, ttl),
        ),
      );
    }
  }

  const elapsed = Date.now() - start;
  const rate = elapsed > 0 ? (items.length / elapsed) * 1000 : 0;
  console.log(
    `[AsyncFastPath] ${items.length} items in ${elapsed.toFixed(1)}ms (${rate.toFixed(0)} items/sec)`,
  );

  return results;
}
