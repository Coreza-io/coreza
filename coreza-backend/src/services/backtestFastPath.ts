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

import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { IndicatorService, IncrementalUpdater } from "./indicators";
import { SimBroker } from "./simBroker";
import {
  compileIfCondition,
  CompiledCondition,
  IndicatorStateValue,
} from "./conditionCompiler";

const SIM_BROKER_KEY_PREFIX = "simBroker:";

const SUPPORTED_INDICATORS = new Set([
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
]);

const FAST_PATH_SUPPORTED_NODE_NAMES = new Set([
  ...SUPPORTED_INDICATORS,
  "If",
  "BacktestTrade",
  "BacktestSnapshot",
]);

interface CompiledIndicator {
  nodeId: string;
  updater: IncrementalUpdater;
}

interface CompiledTrade {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  ifNodeId?: string;
  branch?: "true" | "false";
}

interface CompiledSnapshot {
  symbol: string;
}

export interface CompiledBacktest {
  indicators: CompiledIndicator[];
  conditions: CompiledCondition[];
  trades: CompiledTrade[];
  snapshot: CompiledSnapshot | null;
  simBroker: SimBroker;
  symbol: string;
}

function toStaticNumber(value: any): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  if (value.includes("{{")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStaticString(value: any): string | null {
  if (typeof value !== "string") return null;
  return value.includes("{{") ? null : value;
}

function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue = Array.from(indegree.entries())
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id);

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) continue;

    const node = nodeById.get(nodeId);
    if (!node) continue;
    sorted.push(node);

    for (const neighborId of adjacency.get(nodeId) || []) {
      const nextDegree = (indegree.get(neighborId) || 0) - 1;
      indegree.set(neighborId, nextDegree);
      if (nextDegree === 0) queue.push(neighborId);
    }
  }

  return sorted.length === nodes.length ? sorted : nodes;
}

function normalizeBar(rawBar: any): any {
  const open = Number(rawBar?.o ?? rawBar?.open ?? rawBar?.close ?? rawBar?.c);
  const high = Number(rawBar?.h ?? rawBar?.high ?? open);
  const low = Number(rawBar?.l ?? rawBar?.low ?? open);
  const close = Number(rawBar?.c ?? rawBar?.close ?? open);
  const volume = Number(rawBar?.v ?? rawBar?.volume ?? 0);
  const timestamp =
    String(rawBar?.t ?? rawBar?.timestamp ?? rawBar?.date ?? "") ||
    new Date().toISOString();

  return {
    ...rawBar,
    open,
    high,
    low,
    close,
    volume,
    timestamp,
  };
}

function findBacktestId(context: any): string | null {
  const allResults = context?.getAllNodeResults?.();
  if (!allResults || typeof allResults !== "object") return null;

  for (const result of Object.values(allResults) as any[]) {
    const backtestId =
      result?.data?.backtest_id ??
      result?.backtest_id ??
      result?.output?.backtest_id;

    if (typeof backtestId === "string" && backtestId.length > 0) {
      return backtestId;
    }
  }

  return null;
}

export function canUseFastPath(bodyNodes: WorkflowNode[]): boolean {
  if (!Array.isArray(bodyNodes) || bodyNodes.length === 0) {
    return false;
  }

  const hasIndicator = bodyNodes.some((node) =>
    SUPPORTED_INDICATORS.has(String(node?.name || ""))
  );
  const hasBacktestAction = bodyNodes.some(
    (node) => node?.name === "BacktestTrade" || node?.name === "BacktestSnapshot"
  );

  if (!hasIndicator || !hasBacktestAction) {
    return false;
  }

  return bodyNodes.every((node) =>
    FAST_PATH_SUPPORTED_NODE_NAMES.has(String(node?.name || ""))
  );
}

export function compileFastPath(
  bodyNodes: WorkflowNode[],
  bodyEdges: WorkflowEdge[],
  context: any
): CompiledBacktest | null {
  const sortedNodes = topoSort(bodyNodes, bodyEdges);

  const indicatorNodes = sortedNodes.filter((node) =>
    SUPPORTED_INDICATORS.has(String(node.name || ""))
  );
  const ifNodes = sortedNodes.filter((node) => node.name === "If");
  const tradeNodes = sortedNodes.filter((node) => node.name === "BacktestTrade");
  const snapshotNode = sortedNodes.find((node) => node.name === "BacktestSnapshot");

  const indicators: CompiledIndicator[] = [];
  for (const indicatorNode of indicatorNodes) {
    try {
      const updater = IndicatorService.createIncrementalUpdater(
        String(indicatorNode.name),
        indicatorNode.values || {}
      );
      indicators.push({ nodeId: indicatorNode.id, updater });
    } catch {
      return null;
    }
  }

  const conditions: CompiledCondition[] = [];
  for (const ifNode of ifNodes) {
    const compiled = compileIfCondition(ifNode, indicatorNodes);
    if (!compiled) return null;
    conditions.push(compiled);
  }

  const trades: CompiledTrade[] = [];
  for (const tradeNode of tradeNodes) {
    const symbol = toStaticString(tradeNode.values?.symbol);
    const side = toStaticString(tradeNode.values?.side)?.toLowerCase();
    const quantity = toStaticNumber(tradeNode.values?.quantity);
    const orderType =
      (toStaticString(tradeNode.values?.order_type) as
        | "market"
        | "limit"
        | "stop"
        | "stop_limit"
        | null) || "market";

    if (
      !symbol ||
      !quantity ||
      (side !== "buy" && side !== "sell") ||
      !["market", "limit", "stop", "stop_limit"].includes(orderType)
    ) {
      return null;
    }

    const incomingFromIf = bodyEdges.find(
      (edge) =>
        edge.target === tradeNode.id &&
        ifNodes.some((ifNode) => ifNode.id === edge.source)
    );

    const branch =
      incomingFromIf?.sourceHandle === "true" ||
      incomingFromIf?.sourceHandle === "false"
        ? incomingFromIf.sourceHandle
        : undefined;

    trades.push({
      symbol,
      side,
      quantity,
      orderType,
      ifNodeId: incomingFromIf?.source,
      branch,
    });
  }

  const snapshotSymbol = snapshotNode
    ? toStaticString(snapshotNode.values?.symbol)
    : null;

  if (snapshotNode && !snapshotSymbol) {
    return null;
  }

  const backtestId = findBacktestId(context);
  if (!backtestId) {
    return null;
  }

  const simBroker = context?.dataContext?.getDataByKey?.(
    `${SIM_BROKER_KEY_PREFIX}${backtestId}`
  );

  if (!(simBroker instanceof SimBroker)) {
    return null;
  }

  const symbol = trades[0]?.symbol || snapshotSymbol || "UNKNOWN";

  return {
    indicators,
    conditions,
    trades,
    snapshot: snapshotSymbol ? { symbol: snapshotSymbol } : null,
    simBroker,
    symbol,
  };
}

export function executeFastPath(
  bars: any[],
  compiled: CompiledBacktest
): Record<string, any> {
  const startedAt = performance.now();

  const indicatorStates = new Map<string, IndicatorStateValue>();
  for (const indicator of compiled.indicators) {
    const warmup = indicator.updater.warmUp([]);
    indicatorStates.set(indicator.nodeId, {
      state: warmup.internalState,
      value: warmup.value,
    });
  }

  const conditionResults = new Map<string, boolean>();

  for (const rawBar of bars) {
    const bar = normalizeBar(rawBar);

    for (const indicator of compiled.indicators) {
      const current = indicatorStates.get(indicator.nodeId);
      if (!current) continue;

      const next = indicator.updater.update(current.state, bar);
      current.state = next.internalState;
      current.value = next.value;
    }

    for (const condition of compiled.conditions) {
      conditionResults.set(condition.nodeId, condition.evaluate(indicatorStates));
    }

    compiled.simBroker.onBar(compiled.symbol, bar);

    for (const trade of compiled.trades) {
      const conditionValue = trade.ifNodeId
        ? conditionResults.get(trade.ifNodeId)
        : undefined;

      const shouldExecute =
        !trade.ifNodeId ||
        (trade.branch === "false"
          ? conditionValue === false
          : conditionValue === true || conditionValue === undefined);

      if (!shouldExecute) continue;

      compiled.simBroker.placeOrder({
        symbol: trade.symbol,
        side: trade.side,
        type: trade.orderType,
        quantity: trade.quantity,
      });

      compiled.simBroker.onBar(trade.symbol, bar);
    }

    if (compiled.snapshot) {
      compiled.simBroker.recordSnapshot(bar.timestamp, {
        [compiled.snapshot.symbol]: bar.close,
      });
    }
  }

  const elapsed = performance.now() - startedAt;
  console.log(
    `[FastPath] Processed ${bars.length} bars in ${elapsed.toFixed(1)}ms`
  );

  return {
    trades: compiled.simBroker.getTrades(),
    equityCurve: compiled.simBroker.getEquityCurve(),
    metrics: compiled.simBroker.getMetrics(),
    portfolioState: compiled.simBroker.getPortfolioState(),
    fastPath: {
      barsProcessed: bars.length,
      elapsedMs: elapsed,
    },
  };
}
