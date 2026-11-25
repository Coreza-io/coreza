/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { WorkflowNode, NodeResult } from "../../nodes/types";
import { ExecutionMode } from "../../engine/types";

/**
 * Compiled Plan VM Types
 * ======================
 * Defines the instruction set and data structures for the pre-compiled
 * execution plan that replaces the dynamic queue/routing engine in
 * backtest mode.
 */

export const enum OpCode {
  /** Execute a node and store result in outSlot */
  EXEC = 0,
  /** Execute a conditional node (If/Switch), then selectively activate downstream slots */
  BRANCH = 1,
}

export const enum BranchEnum {
  FALSE = 0,
  TRUE = 1,
  DEFAULT = 2,
  EMPTY = 3,
}

/**
 * Function signature for wrapped node executors in the compiled plan.
 * The adapter pre-resolves parameters and injects them via context override.
 */
export type ExecFn = (
  node: WorkflowNode,
  input: any,
  resolvedParams: Record<string, any>,
  ctx: CompiledExecContext,
) => NodeResult | Promise<NodeResult>;

/**
 * Resolves node parameters by reading from the slots array
 * instead of the dynamic allNodeData record.
 */
export type SlotParamResolver = (slots: any[]) => Record<string, any>;

export interface ActivationTarget {
  instructionIndex: number;
  /** Global dependency-group slot, or -1 for an entry activation. */
  dependencyGroupIndex: number;
  /** Result slot carried by the edge that activated the target. */
  inputSlot: number;
}

/**
 * A single instruction in the compiled plan.
 */
export interface Instruction {
  /** OpCode determining execution behavior */
  op: OpCode;
  /** Dense slot index where this node's result is written */
  outSlot: number;
  /** Slot index used as this instruction's input payload */
  inputSlot: number;
  /** The workflow node definition (frozen reference) */
  node: WorkflowNode;
  /** Pre-bound executor adapter */
  exec: ExecFn;
  /** Whether this executor is declared as potentially asynchronous. */
  isAsyncNode: boolean;
  /** Resolves params from slots[] */
  resolveParams: SlotParamResolver;
  /**
   * For EXEC: all downstream instruction indices to activate.
   * For BRANCH: unused (branchMap is used instead).
   */
  downstreamSlots: ActivationTarget[];
  /**
   * For BRANCH (If/Switch) nodes only.
   * Integer-indexed branch target arrays.
   * e.g. [falseTargets, trueTargets, defaultTargets, emptyTargets]
   */
  branchTargets?: ActivationTarget[][];
  /** For Switch BRANCH nodes: maps result string → target instruction indices. */
  branchStringMap?: Map<string, ActivationTarget[]>;
}

/**
 * Entry in pinnedSlotEntries — maps a pinned nodeId result
 * to a slot index so it can be written once per bar.
 */
export interface PinnedSlotEntry {
  slotIndex: number;
  value: any;
}

/**
 * The fully compiled execution plan.
 * Created once at backtest start, reused for every bar.
 */
export interface CompiledPlan {
  /** Total bars executed by this plan */
  barCount: number;
  /** Sample every N bars for per-instruction timing (0 disables) */
  timingSampleRate: number;
  /** Accumulated sampled instruction execution time in ms */
  instructionTimingMs: Float64Array;
  /** Number of sampled executions per instruction */
  instructionTimingCount: Uint32Array;
  /** Ordered instructions in topological order */
  instructions: Instruction[];
  /** Dense result array — one slot per node + extras for input/pinned */
  slots: any[];
  /** Activation flags — active[i] = 1 means instruction i should execute */
  active: Uint8Array;
  /** Number of incoming dependencies satisfied for each instruction this bar. */
  activationCounts: Uint32Array;
  /** Marks each distinct dependency group satisfied during the current bar. */
  satisfiedDependencyGroups: Uint8Array;
  /** Incoming dependency groups required before each instruction can execute. */
  requiredActivationCounts: Uint32Array;
  /** Input slot delivered by the most recently satisfied dependency. */
  activeInputSlots: Int32Array;
  /** Instruction indices that are entry points (receive bar input) */
  entryIndices: number[];
  /** Pinned results to restore each bar (BacktestInit outputs) */
  pinnedSlotEntries: PinnedSlotEntry[];
  /** Slot index where bar input event is written */
  inputSlot: number;
  /** Shared execution context (nodeId is mutated per-instruction) */
  ctx: CompiledExecContext;
  /** Map from nodeId to instruction index (for timing/debugging) */
  nodeIdToInstrIndex: Map<string, number>;
  /** Node result cache invalidation flag for getAllNodeResults() */
  nodeResultsDirty: boolean;
  /** Lazily rebuilt all-node-results cache */
  allNodeResultsCache: Record<string, any>;
  /** Optional sampled VM internals timing */
  vmTimingMs: Float64Array;
  /** Optional sampled VM internals counts */
  vmTimingCount: Uint32Array;
}

/**
 * Execution context passed to compiled plan executors.
 * Mirrors the WorkflowEngine's ExecutionContext but with
 * resolveNodeParameters overridden to return pre-resolved params.
 */
export interface CompiledExecContext {
  isWarmingUp: boolean;
  nodeId: string;
  runId: string;
  workflowId: string;
  userId: string;
  user_id: string;
  nodes: WorkflowNode[];
  edges: any[];
  multiBarContext?: {
    timestamp: string;
    interval: string;
    symbols: string[];
    currentSymbol: string;
    bars: Record<string, any>;
    getBar: (symbol: string) => any;
  };
  dataContext: any;
  indicatorStateManager: any;
  abortSignal?: AbortSignal;
  executionMode: ExecutionMode;
  /** Per-instruction pre-resolved params injected by VM */
  resolvedParams?: Record<string, any>;
  /** Overridden to return pre-resolved params from slots */
  resolveNodeParameters: (node: WorkflowNode, input: any) => any;
  /** Returns all node results — reads from slots for compiled plan */
  getAllNodeResults: () => Record<string, any>;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
  checkCancellation: () => boolean;
}
