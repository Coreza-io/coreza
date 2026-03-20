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

import { WorkflowNode, NodeResult } from "../../nodes/types";

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
) => NodeResult;

/**
 * Resolves node parameters by reading from the slots array
 * instead of the dynamic allNodeData record.
 */
export type SlotParamResolver = (slots: any[]) => Record<string, any>;

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
  /** Resolves params from slots[] */
  resolveParams: SlotParamResolver;
  /**
   * For EXEC: all downstream instruction indices to activate.
   * For BRANCH: unused (branchMap is used instead).
   */
  downstreamSlots: number[];
  /**
   * For BRANCH (If/Switch) nodes only.
   * Integer-indexed branch target arrays.
   * e.g. [falseTargets, trueTargets, defaultTargets, emptyTargets]
   */
  branchTargets?: number[][];
  /** For Switch BRANCH nodes: maps result string → target instruction indices. */
  branchStringMap?: Map<string, number[]>;
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
  isBacktest: boolean;
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
