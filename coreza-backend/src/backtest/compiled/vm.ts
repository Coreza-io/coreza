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

import { OpCode, BranchEnum, CompiledPlan } from "./types";

/**
 * Compiled Plan VM
 * ================
 * The tight per-bar execution loop. No Maps, no Sets, no queue,
 * no dependency checks — pure array reads/writes.
 *
 * Per-bar cost:
 * - active.fill(0)             → single native memset
 * - Write pinned + input       → N+1 array writes
 * - Linear instruction scan    → N iterations, skip inactive
 * - Execute + propagate        → array writes for results + activation
 */

/**
 * Execute one bar through the compiled plan.
 *
 * @param plan The pre-compiled execution plan (mutated in place — slots[] and active[])
 * @param barInput The bar event data for this bar
 */
export function runBar(plan: CompiledPlan, barInput: any): void {
  const { instructions, slots, active, entryIndices, inputSlot, ctx } = plan;
  const len = instructions.length;

  // ── Reset ─────────────────────────────────────────────────────────
  active.fill(0);


  // ── Write bar input ───────────────────────────────────────────────
  slots[inputSlot] = barInput;
  plan.nodeResultsDirty = true;
  plan.barCount += 1;

  const timingEnabled = plan.timingSampleRate > 0 && (plan.barCount % plan.timingSampleRate === 0);
  let resolveParamsMs = 0;
  let execMs = 0;
  let activateMs = 0;

  // ── Activate entry nodes ──────────────────────────────────────────
  for (let e = 0; e < entryIndices.length; e++) {
    active[entryIndices[e]] = 1;
  }

  // ── Execute instruction scan ──────────────────────────────────────
  for (let i = 0; i < len; i++) {
    if (!active[i]) continue;

    const instr = instructions[i];

    // Resolve params from slots
    const resolveStart = timingEnabled ? performance.now() : 0;
    const params = instr.resolveParams(slots);
    if (timingEnabled) {
      resolveParamsMs += performance.now() - resolveStart;
    }

    // Execute node
    const execStart = timingEnabled ? performance.now() : 0;
    const result = instr.exec(instr.node, slots[instr.inputSlot], params, ctx);
    if (timingEnabled) {
      const elapsed = performance.now() - execStart;
      plan.instructionTimingMs[i] += elapsed;
      plan.instructionTimingCount[i] += 1;
      execMs += elapsed;
    }

    // Store result in slot
    slots[instr.outSlot] = result;
    plan.nodeResultsDirty = true;

    // Propagate activation to downstream nodes
    const activateStart = timingEnabled ? performance.now() : 0;
    if (result?.success === false) {
      if (timingEnabled) {
        activateMs += performance.now() - activateStart;
      }
      continue;
    }

    if (instr.op === OpCode.BRANCH) {
      // Conditional node: selectively activate based on result
      const resultData = result?.data;
      const branchTargets = instr.branchTargets!;

      if (typeof resultData === "boolean") {
        const targets = branchTargets[resultData ? BranchEnum.TRUE : BranchEnum.FALSE];
        for (let t = 0; t < targets.length; t++) {
          active[targets[t]] = 1;
        }
      } else if (typeof resultData === "string") {
        const branchIndex = resultData === "true"
          ? BranchEnum.TRUE
          : resultData === "false"
            ? BranchEnum.FALSE
            : resultData === ""
              ? BranchEnum.EMPTY
              : BranchEnum.DEFAULT;
        const targets = branchTargets[branchIndex];
        for (let t = 0; t < targets.length; t++) {
          active[targets[t]] = 1;
        }
      } else if (
        resultData &&
        typeof resultData === "object" &&
        ("true" in resultData || "false" in resultData)
      ) {
        if (resultData.true) {
          const trueTargets = branchTargets[BranchEnum.TRUE];
          for (let t = 0; t < trueTargets.length; t++) {
            active[trueTargets[t]] = 1;
          }
        }
        if (resultData.false) {
          const falseTargets = branchTargets[BranchEnum.FALSE];
          for (let t = 0; t < falseTargets.length; t++) {
            active[falseTargets[t]] = 1;
          }
        }
        if (!resultData.true && !resultData.false) {
          const defaultTargets = branchTargets[BranchEnum.DEFAULT];
          for (let t = 0; t < defaultTargets.length; t++) {
            active[defaultTargets[t]] = 1;
          }
          const emptyTargets = branchTargets[BranchEnum.EMPTY];
          for (let t = 0; t < emptyTargets.length; t++) {
            active[emptyTargets[t]] = 1;
          }
        }
      } else {
        const targets = branchTargets[BranchEnum.DEFAULT];
        for (let t = 0; t < targets.length; t++) {
          active[targets[t]] = 1;
        }
        const emptyTargets = branchTargets[BranchEnum.EMPTY];
        for (let t = 0; t < emptyTargets.length; t++) {
          active[emptyTargets[t]] = 1;
        }
      }
    } else {
      // Regular node: activate all downstream
      const downstream = instr.downstreamSlots;
      for (let d = 0; d < downstream.length; d++) {
        active[downstream[d]] = 1;
      }
    }
    if (timingEnabled) {
      activateMs += performance.now() - activateStart;
    }
  }

  if (timingEnabled) {
    plan.vmTimingMs[0] += resolveParamsMs;
    plan.vmTimingMs[1] += execMs;
    plan.vmTimingMs[2] += activateMs;
    plan.vmTimingCount[0] += 1;
    plan.vmTimingCount[1] += 1;
    plan.vmTimingCount[2] += 1;
  }
}
