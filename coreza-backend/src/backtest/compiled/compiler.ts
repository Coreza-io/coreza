/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { WorkflowNode, WorkflowEdge, INodeExecutor } from "../../nodes/types";
import { CompiledNodeParams } from "../../utils/templateCompiler";
import { compileParamsToSlots } from "../../utils/templateCompiler";
import { GraphRuntime } from "../../engine/graphRuntime";
import {
  OpCode,
  BranchEnum,
  Instruction,
  CompiledPlan,
  PinnedSlotEntry,
  CompiledExecContext,
  SlotParamResolver,
} from "./types";
import { buildExecAdapter, resolveCategory } from "./adapters";

function branchHandleToEnum(handle: string): BranchEnum {
  switch (handle) {
    case "true":
      return BranchEnum.TRUE;
    case "false":
      return BranchEnum.FALSE;
    case "":
      return BranchEnum.EMPTY;
    case "default":
    case "fallback":
    default:
      return BranchEnum.DEFAULT;
  }
}

const INELIGIBLE_NODE_NAMES = new Set([
  "Loop",
  "Switch",
  "AIAgent",
  "LLM",
  "InitializeIndicators",
]);

export function compilePlan(
  graph: GraphRuntime,
  nodeExecutorMap: ReadonlyMap<string, INodeExecutor>,
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
  const nodes = [...graph.nodeById.values()];

  for (const node of nodes) {
    if (INELIGIBLE_NODE_NAMES.has(node.name ?? "")) {
      console.log(
        `[CompiledPlan] Ineligible: node "${node.id}" is type "${node.name}"`,
      );
      return null;
    }

    const executor = nodeExecutorMap.get(node.id);
    if (!executor) {
      const category = resolveCategory(node);
      console.log(
        `[CompiledPlan] Ineligible: no executor for category "${category}" (node ${node.id})`,
      );
      return null;
    }

    const cp = compiledParams.get(node.id);
    if (cp?.fallbackKeys && cp.fallbackKeys.length > 0) {
      console.log(
        `[CompiledPlan] Ineligible: node "${node.id}" has fallback template keys: ${cp.fallbackKeys.join(", ")}`,
      );
      return null;
    }
  }

  const topoOrder = graph.topoSort();
  if (topoOrder.length !== nodes.length) {
    console.log(
      `[CompiledPlan] Ineligible: cycle detected (sorted ${topoOrder.length}/${nodes.length} nodes)`,
    );
    return null;
  }

  let nextSlot = 0;
  const inputSlot = nextSlot++;

  const pinnedSlotEntries: PinnedSlotEntry[] = [];
  const slotMap = new Map<string, number>();

  for (const [nodeId, value] of Object.entries(pinnedResults)) {
    const slot = nextSlot++;
    slotMap.set(nodeId, slot);
    pinnedSlotEntries.push({ slotIndex: slot, value });
  }

  const nodeIdToInstrIndex = new Map<string, number>();
  for (let i = 0; i < topoOrder.length; i++) {
    const nodeId = topoOrder[i];
    if (!slotMap.has(nodeId)) slotMap.set(nodeId, nextSlot++);
    nodeIdToInstrIndex.set(nodeId, i);
  }

  const totalSlots = nextSlot;
  const slotResolvers = new Map<string, SlotParamResolver>();

  for (const nodeId of topoOrder) {
    const cp = compiledParams.get(nodeId);
    const resolver = compileParamsToSlots(
      cp ?? null,
      slotMap,
      cp?.templateDeps,
    );
    if (!resolver) {
      console.log(
        `[CompiledPlan] Ineligible: failed to compile params to slots for node "${nodeId}"`,
      );
      return null;
    }
    slotResolvers.set(nodeId, resolver);
  }

  const instructions: Instruction[] = [];

  for (const nodeId of topoOrder) {
    const node = graph.nodeById.get(nodeId)!;
    const executor = nodeExecutorMap.get(nodeId)!;
    const execFn = buildExecAdapter(executor);
    const resolveParams = slotResolvers.get(nodeId)!;
    const outSlot = slotMap.get(nodeId)!;
    const isConditional = node.name === "If" || node.name === "Switch";
    const incoming = graph.getIncomingEdges(nodeId);
    const nodeInputSlot =
      incoming.length > 0
        ? (slotMap.get(incoming[0].source) ?? inputSlot)
        : inputSlot;

    if (isConditional) {
      const branchTargets: number[][] = [[], [], [], []];
      const branchStringMap =
        node.name === "Switch" ? new Map<string, number[]>() : undefined;
      for (const edge of graph.getOutgoingEdges(nodeId)) {
        const handle = edge.sourceHandle ?? "";
        const targetInstrIdx = nodeIdToInstrIndex.get(edge.target);
        if (targetInstrIdx === undefined) continue;

        if (branchStringMap) {
          const targets = branchStringMap.get(handle);
          if (targets) targets.push(targetInstrIdx);
          else branchStringMap.set(handle, [targetInstrIdx]);

          if (handle === "" || handle === "default" || handle === "fallback") {
            branchTargets[BranchEnum.DEFAULT].push(targetInstrIdx);
          }
          continue;
        }

        branchTargets[branchHandleToEnum(handle)].push(targetInstrIdx);
      }

      instructions.push({
        op: OpCode.BRANCH,
        outSlot,
        inputSlot: nodeInputSlot,
        node,
        exec: execFn,
        isAsyncNode: executor.syncCapable !== true,
        resolveParams,
        downstreamSlots: [],
        branchTargets,
        branchStringMap,
      });
      continue;
    }

    const downstream: number[] = [];
    for (const edge of graph.getOutgoingEdges(nodeId)) {
      const targetInstrIdx = nodeIdToInstrIndex.get(edge.target);
      if (targetInstrIdx !== undefined) downstream.push(targetInstrIdx);
    }

    instructions.push({
      op: OpCode.EXEC,
      outSlot,
      inputSlot: nodeInputSlot,
      node,
      exec: execFn,
      isAsyncNode: executor.syncCapable !== true,
      resolveParams,
      downstreamSlots: downstream,
    });
  }

  const entryIndices: number[] = [];
  for (const entryId of entryNodeIds) {
    const idx = nodeIdToInstrIndex.get(entryId);
    if (idx !== undefined) entryIndices.push(idx);
  }

  const slots = new Array(totalSlots).fill(null);
  for (let p = 0; p < pinnedSlotEntries.length; p++) {
    const entry = pinnedSlotEntries[p];
    slots[entry.slotIndex] = entry.value;
  }

  const ctx: CompiledExecContext = {
    isWarmingUp: false,
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
    executionMode: "backtest",
    resolveNodeParameters: () => ctx.resolvedParams ?? {},
    getAllNodeResults: () => {
      if (plan.nodeResultsDirty) {
        for (const [nodeId, slotIdx] of slotMap.entries()) {
          plan.allNodeResultsCache[nodeId] = slots[slotIdx];
        }
        plan.nodeResultsDirty = false;
      }
      return plan.allNodeResultsCache;
    },
    getState: (key: string) => ctxBase.storeGetState(ctx.nodeId, key),
    setState: (key: string, value: any) =>
      ctxBase.storeSetState(ctx.nodeId, key, value),
    checkCancellation: () => ctxBase.abortSignal?.aborted ?? false,
  };

  const timingSampleRate = Number(
    process.env.COMPILED_PLAN_TIMING_SAMPLE_RATE ?? "0",
  );

  const plan: CompiledPlan = {
    instructions,
    barCount: 0,
    timingSampleRate:
      Number.isFinite(timingSampleRate) && timingSampleRate > 0
        ? Math.floor(timingSampleRate)
        : 0,
    instructionTimingMs: new Float64Array(instructions.length),
    instructionTimingCount: new Uint32Array(instructions.length),
    slots,
    active: new Uint8Array(instructions.length),
    entryIndices,
    pinnedSlotEntries,
    inputSlot,
    ctx,
    nodeIdToInstrIndex,
    nodeResultsDirty: true,
    allNodeResultsCache: Object.create(null),
    vmTimingMs: new Float64Array(3),
    vmTimingCount: new Uint32Array(3),
  };

  console.log(
    `[CompiledPlan] ✅ Compiled ${instructions.length} instructions, ${totalSlots} slots, ${entryIndices.length} entries`,
  );

  return plan;
}
