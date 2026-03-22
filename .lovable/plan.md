

# Fix: Skip Trigger Node Re-Execution in WorkflowRunner

## Problem

`WorkflowRunner.processMessage()` calls `engine.execute({ data: envelope.data })` which enqueues all entry/trigger nodes (like `OnBar`) for full execution. But the trigger already fired — the stream data IS the trigger's output. Re-executing it causes the executor to run registration logic again, producing "Waiting for market data" instead of passing through the actual bar data.

## Solution

Instead of `engine.execute()`, use the engine's existing `preloadResults` + `executeFromEntries` pattern:

1. **Preload** the trigger node's result with the stream data (so downstream nodes can reference it via `$('OnBar').json`)
2. **Start execution from downstream nodes** of the trigger, skipping the trigger executor entirely

The engine already supports this — `WorkflowRun.preloadResults()` sets node results without executing, and `executeFromEntries()` starts from specific nodes with primed edge payloads.

## Changes

### File: `coreza-backend/src/services/WorkflowRunner.ts`

**Constructor** — cache entry node IDs and their downstream targets at build time:

```typescript
private readonly triggerNodeIds: string[];
private readonly downstreamEntryIds: string[];

// In constructor, after engine creation:
const plan = this.engine.plan; // or access via graph
this.triggerNodeIds = plan.entryNodeIds as string[];
this.downstreamEntryIds = this.triggerNodeIds
  .flatMap(id => plan.graph.getOutgoingEdges(id).map(e => e.target));
```

**`processMessage()`** — replace `engine.execute()` with preload + downstream execution:

```typescript
// Phase 4: Execute workflow — skip trigger, start from downstream
this.engine.resetForNextBar(true);

// Build trigger output from the stream envelope
const triggerOutput = { success: true, data: envelope.data };

// Preload trigger results so downstream nodes can reference them
const preload: Record<string, any> = {};
for (const triggerId of this.triggerNodeIds) {
  preload[triggerId] = triggerOutput;
}
this.engine.run.preloadResults(preload);

// Execute from downstream nodes only (skip trigger executors)
const executionResult = await this.engine.executeFromEntries(
  { data: envelope.data },
  this.downstreamEntryIds,
);
```

**Expose `plan` and `run`** — `WorkflowEngine` already exposes `run` but `plan` may need a getter. Check and add if needed:

```typescript
// In WorkflowEngine class, if not already present:
get plan(): WorkflowPlan { return this._plan; }
```

## Why This Is Correct

- `preloadResults` stores the trigger output in `NodeStoreV2` — any downstream node referencing `$('OnBar').json.data` gets the real bar data
- `executeFromEntries` calls `primeEntry()` on each downstream node (marks incoming edges as satisfied) then enqueues them
- The trigger node never runs its executor, so no "waiting for market data" message
- `executionOrder` will contain only the actually-executed nodes (no trigger re-entry)
- This matches the backtest pattern where `BacktestInit` outputs are pinned and bars execute from `OnBar` downstream

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/services/WorkflowRunner.ts` | Cache trigger/downstream IDs in constructor; replace `engine.execute()` with `preloadResults` + `executeFromEntries` |
| `coreza-backend/src/engine/workflowEngine.ts` | Add `plan` getter if not already exposed |

