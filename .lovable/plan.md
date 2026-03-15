

# Phase 1: Compiled Plan VM — Implementation Plan

## What This Does

Replaces the per-bar queue/routing/dependency-check engine with a pre-compiled flat instruction array. Instead of enqueueing 14 nodes, checking dependencies, routing edges, and managing Maps per bar — the VM executes a linear scan of pre-ordered instructions, storing results in a plain `slots[]` array.

## Architecture

```text
BacktestSession.constructor()
  │
  ├─ compilePlan(nodes, edges, compiledParams, pinnedResults)
  │     ├─ Validate: all nodes have executeSync, no Loops, no unsupported templates
  │     ├─ Topo-sort nodes
  │     ├─ Assign slot indices (0..N-1)
  │     ├─ Compile params to read from slots[] instead of allNodeData{}
  │     ├─ Wrap executors into ExecFn adapters
  │     └─ Return CompiledPlan { instructions[], slots[], active Uint8Array, ... }
  │
  └─ runAll()
       ├─ if (compiledPlan) → runBarCompiled() per bar  ← NEW (no engine)
       └─ else → existing resetForNextBar() + executeFromEntriesSync()
```

Per-bar execution with the VM:
```text
active.fill(0)
slots[pinnedSlots] = pinnedValues   // BacktestInit results
slots[inputSlot] = barEvent
active[entrySlots] = 1

for i = 0..instructions.length:
  if !active[i]: continue
  instr = instructions[i]
  params = instr.resolveParams(slots)
  slots[instr.outSlot] = instr.exec(node, params, ctx)
  // Branch handling for If/Switch:
  if instr.type === BRANCH:
    activate downstream slots based on result
  else:
    activate all downstream slots
```

## Files to Create/Modify

### New: `coreza-backend/src/services/compiledPlan/types.ts`
- `OpCode` enum: `EXEC`, `BRANCH`
- `ExecFn` type: `(node, input, resolvedParams, ctx) => NodeResult`
- `SlotAccessorFn` type: `(slots: any[]) => Record<string, any>`
- `Instruction` interface: `{ op, outSlot, node, exec, resolveParams, downstreamSlots[], branchMap? }`
- `CompiledPlan` interface: `{ instructions[], slots[], active: Uint8Array, entrySlots[], pinnedSlotEntries[], inputSlot, ctx }`

### New: `coreza-backend/src/services/compiledPlan/compiler.ts`
- `compilePlan(nodes, edges, entryNodeIds, compiledParams, pinnedResults, engineCtxFactory)` → `CompiledPlan | null`
- **Eligibility check**: All nodes must have sync executors. No Loop nodes. No unsupported template patterns (fallbackKeys).
- **Topo sort**: Kahn's algorithm using the existing `incomingEdges`/`outgoingEdges` structure. If cycle detected → return null.
- **Slot assignment**: Dense index map `nodeId → slotIndex`. Extra slot for bar input. Pinned results get their own slots.
- **Param compilation**: For each node, use existing `CompiledNodeParams`. Replace `allNodeData[nodeName]` accessors with `slots[slotMap.get(nodeName)]` reads via `compileParamsToSlots()`.
- **Instruction emission**: One instruction per node in topo order. For If/Switch nodes, emit `BRANCH` op with a map of `sourceHandle → downstream slot indices`.
- **Adapter binding**: Wrap each node's executor via `buildExecAdapter()`.

### New: `coreza-backend/src/services/compiledPlan/vm.ts`
- `runBar(plan, barEvent)`: The tight per-bar loop.
  - `plan.active.fill(0)`
  - Write pinned results and bar input into slots
  - Activate entry slots
  - Linear scan: skip inactive, execute active, propagate activation
- No Maps, no Sets, no queue, no dependency checks — pure array reads/writes.

### New: `coreza-backend/src/services/compiledPlan/adapters.ts`
- `buildExecAdapter(node, executor, category)` → `ExecFn`
  - Wraps `executor.executeSync(node, input, context)` into the `ExecFn` signature
  - Handles the `resolveNodeParameters` injection: in the compiled plan, params are pre-resolved by `resolveParams(slots)`, so the adapter passes them directly
  - Special handling for executors that call `context.resolveNodeParameters` internally (BacktestExecutor, IndicatorsExecutor, etc.) — the adapter overrides `context.resolveNodeParameters` to return the pre-resolved params

### Modified: `coreza-backend/src/utils/templateCompiler.ts`
- Add `compileParamsToSlots(compiledNodeParams, slotMap)` → `SlotAccessorFn`
  - Takes existing compiled accessors and rewires them: instead of `allNodeData[nodeName]` → `slots[slotMap.get(nodeName)]`
  - For static params: returns a function that always returns the static object
  - For params with fallbackKeys: returns null (ineligible for compiled plan)

### Modified: `coreza-backend/src/services/BacktestSession.ts`
- In constructor: after creating the engine, attempt `compilePlan(nodes, edges, entryNodeIds, compiledParams, backtestInitResult, engine)`
- Store `private compiledPlan: CompiledPlan | null`
- In `runAll()`: if `compiledPlan` exists, use compiled path:
  ```
  while (currentIndex < bars.length) {
    runBar(this.compiledPlan, this.bars[this.currentIndex]);
    this.currentIndex++;
    // yield every 500 bars (same as current)
  }
  ```
- In `step()`: same pattern — if compiled plan exists, use `runBar()` instead of engine
- Fallback: if `compilePlan()` returns null, existing engine path runs unchanged

## Key Design Decisions

1. **Adapter layer, not rewrite** — Existing executors are called through thin wrappers. Zero changes to executor logic.

2. **Graceful fallback** — If any node lacks `executeSync`, has `fallbackKeys` in its compiled params, or uses Loops, `compilePlan()` returns `null` and the existing engine runs. Zero regression risk.

3. **Shared execution context** — A single `ctx` object is created once and mutated per-node (just `ctx.nodeId` changes), same pattern as current `getExecutionContext()`. The `resolveNodeParameters` on ctx is overridden to return pre-resolved params from slots.

4. **Branch handling** — If/Switch nodes use `BRANCH` op. The compiler pre-computes which downstream slot indices belong to each `sourceHandle`. At runtime, the VM reads the branch result and activates only the correct downstream slots.

5. **State preservation** — DataContext, IndicatorStateManager, SimBroker all work the same — they're accessed through the execution context, which is passed through the adapter. The VM doesn't touch stateful services.

## Implementation Order

| Step | Description |
|---|---|
| 1 | Create `types.ts` — all interfaces and enums |
| 2 | Create `adapters.ts` — executor wrapping |
| 3 | Add `compileParamsToSlots` to `templateCompiler.ts` |
| 4 | Create `compiler.ts` — topo sort, slot assignment, instruction emission, eligibility |
| 5 | Create `vm.ts` — the runBar loop |
| 6 | Integrate into `BacktestSession.ts` — attempt compilation, use compiled path in `runAll()`/`step()` |

