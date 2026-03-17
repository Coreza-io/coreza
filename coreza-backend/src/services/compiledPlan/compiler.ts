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

import { WorkflowNode, WorkflowEdge, INodeExecutor } from "../../nodes/types";
import { getNodeExecutor } from "../../nodes/registry";
import { CompiledNodeParams } from "../../utils/templateCompiler";
import { compileParamsToSlots } from "../../utils/templateCompiler";
import {
  OpCode,
  Instruction,
  CompiledPlan,
  PinnedSlotEntry,
  CompiledExecContext,
  SlotParamResolver,
} from "./types";
import { buildExecAdapter, resolveCategory } from "./adapters";

/**
 * Compiled Plan Compiler
 * ======================
 * Transforms a workflow DAG into a flat instruction array with slot-based
 * memory. Performs eligibility checks, topological sorting, slot assignment,
 * parameter compilation, and instruction emission.
 *
 * Returns null if the workflow cannot be compiled (unsupported nodes, cycles,
 * fallback templates, etc.) — the caller falls back to the dynamic engine.
 */

// Node types that are NOT supported by the compiled plan
const INELIGIBLE_NODE_NAMES = new Set(["Loop", "AIAgent", "LLM", "InitializeIndicators"]);

/**
 * Attempt to compile a workflow into a CompiledPlan.
 *
 * @param nodes All workflow nodes in the strategy subgraph
 * @param edges All workflow edges in the strategy subgraph
 * @param entryNodeIds Node IDs that receive bar input (strategy entries)
 * @param compiledParams Pre-compiled node params from templateCompiler
 * @param pinnedResults Results to persist across bars (BacktestInit outputs)
 * @param ctxBase Base execution context fields (runId, workflowId, userId, etc.)
 * @returns CompiledPlan if eligible, null otherwise
 */
export function compilePlan(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  entryNodeIds: string[],
  compiledParams: Map<string, CompiledNodeParams>,
  pinnedResults: Record<string, any>,
  ctxBase: {
    runId: string;
    workflowId: string;
    userId: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    dataContext: any;
    indicatorStateManager: any;
    abortSignal?: AbortSignal;
    storeGetState: (nodeId: string, key: string) => any;
    storeSetState: (nodeId: string, key: string, value: any) => void;
  },
): CompiledPlan | null {
  // ── Step 1: Eligibility checks ────────────────────────────────────
  const executorMap = new Map<string, INodeExecutor>();

  for (const node of nodes) {
    // Check for ineligible node types
    if (INELIGIBLE_NODE_NAMES.has(node.name ?? "")) {
      console.log(
        `[CompiledPlan] Ineligible: node "${node.id}" is type "${node.name}"`,
      );
      return null;
    }

    // Resolve executor and verify sync capability
    const category = resolveCategory(node);
    let executor = executorMap.get(category);
    if (!executor) {
      executor = getNodeExecutor(category) ?? undefined;
      if (!executor) {
        console.log(
          `[CompiledPlan] Ineligible: no executor for category "${category}" (node ${node.id})`,
        );
        return null;
      }
      executorMap.set(category, executor);
    }

    if (!executor.syncCapable) {
      console.log(
        `[CompiledPlan] Ineligible: executor "${category}" is not syncCapable`,
      );
      return null;
    }

    // Check for fallback template keys (unsupported patterns)
    const cp = compiledParams.get(node.id);
    if (cp?.fallbackKeys && cp.fallbackKeys.length > 0) {
      console.log(
        `[CompiledPlan] Ineligible: node "${node.id}" has fallback template keys: ${cp.fallbackKeys.join(", ")}`,
      );
      return null;
    }
  }

  // ── Step 2: Build adjacency structures ────────────────────────────
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, WorkflowEdge[]>();
  const inEdges = new Map<string, WorkflowEdge[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    outEdges.set(node.id, []);
    inEdges.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    outEdges.get(edge.source)!.push(edge);
    inEdges.get(edge.target)!.push(edge);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // ── Step 3: Topological sort (Kahn's algorithm) ───────────────────
  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree) {
    if (deg === 0) queue.push(nodeId);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    topoOrder.push(nodeId);
    for (const edge of outEdges.get(nodeId) ?? []) {
      const newDeg = (inDegree.get(edge.target) ?? 1) - 1;
      inDegree.set(edge.target, newDeg);
      if (newDeg === 0) queue.push(edge.target);
    }
  }

  // Cycle detection
  if (topoOrder.length !== nodes.length) {
    console.log(
      `[CompiledPlan] Ineligible: cycle detected (sorted ${topoOrder.length}/${nodes.length} nodes)`,
    );
    return null;
  }

  // ── Step 4: Slot assignment ───────────────────────────────────────
  // Slot layout: [inputSlot, ...pinnedSlots, ...nodeSlots in topo order]
  let nextSlot = 0;
  const inputSlot = nextSlot++;

  // Pinned results (BacktestInit outputs)
  const pinnedSlotEntries: PinnedSlotEntry[] = [];
  const slotMap = new Map<string, number>(); // nodeId → slot index

  for (const [nodeId, value] of Object.entries(pinnedResults)) {
    const slot = nextSlot++;
    slotMap.set(nodeId, slot);
    pinnedSlotEntries.push({ slotIndex: slot, value });
  }

  // Node slots in topo order
  const nodeIdToInstrIndex = new Map<string, number>();
  for (let i = 0; i < topoOrder.length; i++) {
    const nodeId = topoOrder[i];
    if (!slotMap.has(nodeId)) {
      slotMap.set(nodeId, nextSlot++);
    }
    nodeIdToInstrIndex.set(nodeId, i);
  }

  const totalSlots = nextSlot;

  // ── Step 5: Compile params to slot-based resolvers ────────────────
  const slotResolvers = new Map<string, SlotParamResolver>();

  for (const nodeId of topoOrder) {
    const cp = compiledParams.get(nodeId);
    const resolver = compileParamsToSlots(cp ?? null, slotMap, cp?.templateDeps);
    if (!resolver) {
      console.log(
        `[CompiledPlan] Ineligible: failed to compile params to slots for node "${nodeId}"`,
      );
      return null;
    }
    slotResolvers.set(nodeId, resolver);
  }

  // ── Step 6: Build instructions ────────────────────────────────────
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const instructions: Instruction[] = [];
  const entryIdSet = new Set(entryNodeIds);

  for (const nodeId of topoOrder) {
    const node = nodeById.get(nodeId)!;
    const category = resolveCategory(node);
    const executor = executorMap.get(category)!;
    const execFn = buildExecAdapter(executor);
    const resolveParams = slotResolvers.get(nodeId)!;
    const outSlot = slotMap.get(nodeId)!;
    const isConditional = node.name === "If" || node.name === "Switch";
    const incoming = inEdges.get(nodeId) ?? [];
    const nodeInputSlot = incoming.length > 0
      ? (slotMap.get(incoming[0].source) ?? inputSlot)
      : inputSlot;

    if (isConditional) {
      // BRANCH instruction — build branchMap
      const branchMap: Record<string, number[]> = {};
      for (const edge of outEdges.get(nodeId) ?? []) {
        const handle = edge.sourceHandle ?? "";
        const targetInstrIdx = nodeIdToInstrIndex.get(edge.target);
        if (targetInstrIdx !== undefined) {
          (branchMap[handle] ??= []).push(targetInstrIdx);
        }
      }

      instructions.push({
        op: OpCode.BRANCH,
        outSlot,
        inputSlot: nodeInputSlot,
        node,
        exec: execFn,
        resolveParams,
        downstreamSlots: [], // unused for BRANCH
        branchMap,
      });
    } else {
      // EXEC instruction — all downstream activated
      const downstream: number[] = [];
      for (const edge of outEdges.get(nodeId) ?? []) {
        const targetInstrIdx = nodeIdToInstrIndex.get(edge.target);
        if (targetInstrIdx !== undefined) {
          downstream.push(targetInstrIdx);
        }
      }

      instructions.push({
        op: OpCode.EXEC,
        outSlot,
        inputSlot: nodeInputSlot,
        node,
        exec: execFn,
        resolveParams,
        downstreamSlots: downstream,
      });
    }
  }

  // ── Step 7: Compute entry instruction indices ─────────────────────
  const entryIndices: number[] = [];
  for (const entryId of entryNodeIds) {
    const idx = nodeIdToInstrIndex.get(entryId);
    if (idx !== undefined) entryIndices.push(idx);
  }

  // ── Step 8: Build execution context ───────────────────────────────
  const ctx: CompiledExecContext = {
    nodeId: "",
    runId: ctxBase.runId,
    workflowId: ctxBase.workflowId,
    userId: ctxBase.userId,
    user_id: ctxBase.userId,
    nodes: ctxBase.nodes,
    edges: ctxBase.edges,
    dataContext: ctxBase.dataContext,
    indicatorStateManager: ctxBase.indicatorStateManager,
    abortSignal: ctxBase.abortSignal,
    silent: true,
    // Stable resolver reads params injected by VM/adapter
    resolveNodeParameters: () => ctx.resolvedParams ?? {},
    getAllNodeResults: () => ({}),
    getState: (key: string) => ctxBase.storeGetState(ctx.nodeId, key),
    setState: (key: string, value: any) =>
      ctxBase.storeSetState(ctx.nodeId, key, value),
    checkCancellation: () => ctxBase.abortSignal?.aborted ?? false,
  };

  // ── Assemble plan ─────────────────────────────────────────────────

  const slots = new Array(totalSlots).fill(null);
  for (let p = 0; p < pinnedSlotEntries.length; p++) {
    const entry = pinnedSlotEntries[p];
    slots[entry.slotIndex] = entry.value;
  }
  const timingSampleRate = Number(process.env.COMPILED_PLAN_TIMING_SAMPLE_RATE ?? "0");

  const plan: CompiledPlan = {
    instructions,
    barCount: 0,
    timingSampleRate: Number.isFinite(timingSampleRate) && timingSampleRate > 0 ? Math.floor(timingSampleRate) : 0,
    instructionTimingMs: new Float64Array(instructions.length),
    instructionTimingCount: new Uint32Array(instructions.length),
    slots,
    active: new Uint8Array(instructions.length),
    entryIndices,
    pinnedSlotEntries,
    inputSlot,
    ctx,
    nodeIdToInstrIndex,
  };

  console.log(
    `[CompiledPlan] ✅ Compiled ${instructions.length} instructions, ${totalSlots} slots, ${entryIndices.length} entries`,
  );

  return plan;
}
