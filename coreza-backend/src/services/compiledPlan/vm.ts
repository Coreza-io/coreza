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

import { OpCode, CompiledPlan } from "./types";

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
  const { instructions, slots, active, entryIndices, pinnedSlotEntries, inputSlot, ctx } = plan;
  const len = instructions.length;

  // ── Reset ─────────────────────────────────────────────────────────
  active.fill(0);

  // ── Write pinned results (BacktestInit outputs) ───────────────────
  for (let p = 0; p < pinnedSlotEntries.length; p++) {
    const entry = pinnedSlotEntries[p];
    slots[entry.slotIndex] = entry.value;
  }

  // ── Write bar input ───────────────────────────────────────────────
  slots[inputSlot] = barInput;

  // ── Activate entry nodes ──────────────────────────────────────────
  for (let e = 0; e < entryIndices.length; e++) {
    active[entryIndices[e]] = 1;
  }

  // ── Execute instruction scan ──────────────────────────────────────
  for (let i = 0; i < len; i++) {
    if (!active[i]) continue;

    const instr = instructions[i];

    // Resolve params from slots
    const params = instr.resolveParams(slots);

    // Execute node
    const result = instr.exec(instr.node, slots[instr.inputSlot], params, ctx);

    // Store result in slot
    slots[instr.outSlot] = result;

    // Propagate activation to downstream nodes
    if (instr.op === OpCode.BRANCH) {
      // Conditional node: selectively activate based on result
      const resultData = result?.data;
      let chosen: string[];

      if (typeof resultData === "boolean") {
        chosen = [resultData ? "true" : "false"];
      } else if (typeof resultData === "string") {
        chosen = [resultData];
      } else if (
        resultData &&
        typeof resultData === "object" &&
        ("true" in resultData || "false" in resultData)
      ) {
        chosen = [];
        for (const key in resultData) {
          if (resultData[key]) chosen.push(key);
        }
      } else {
        chosen = ["default", ""];
      }

      // Activate downstream slots for chosen branches
      const branchMap = instr.branchMap!;
      for (let c = 0; c < chosen.length; c++) {
        const targets = branchMap[chosen[c]];
        if (targets) {
          for (let t = 0; t < targets.length; t++) {
            active[targets[t]] = 1;
          }
        }
      }
    } else {
      // Regular node: activate all downstream
      const downstream = instr.downstreamSlots;
      for (let d = 0; d < downstream.length; d++) {
        active[downstream[d]] = 1;
      }
    }
  }
}
