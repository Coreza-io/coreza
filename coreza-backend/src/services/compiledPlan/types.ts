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
   * Maps sourceHandle string → array of downstream instruction indices.
   * e.g. { "true": [3, 4], "false": [5] }
   */
  branchMap?: Record<string, number[]>;
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
  dataContext: any;
  indicatorStateManager: any;
  abortSignal?: AbortSignal;
  silent: boolean;
  /** Overridden to return pre-resolved params from slots */
  resolveNodeParameters: (node: WorkflowNode, input: any) => any;
  /** Returns all node results — reads from slots for compiled plan */
  getAllNodeResults: () => Record<string, any>;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
  checkCancellation: () => boolean;
}
