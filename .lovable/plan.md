

# Simpler Fix: Add `executionId` to NodeExecutionContext

## Problem Recap

In live streaming, `context.runId` is the static `runnerInstanceId` (set once in the constructor). The idempotency key uses `runId`, so all bars for the same symbol/side/quantity produce identical keys → duplicate orders are incorrectly skipped.

## Better Approach: Add `executionId` Instead of Rotating `runId`

Instead of calling `resetForNewRun()` (which destroys indicator state and requires re-carrying it), simply add an `executionId` field to the context. This is cleaner because:

- `runId` keeps its current meaning: the persistent runner/session ID
- `executionId` is unique per event/bar — used only for idempotency
- No need to destroy and recreate `WorkflowRun` each event
- Indicator state, node state, data context all preserved naturally
- Minimal change surface

## Changes

### 1. Add `executionId` to `NodeExecutionContext`

**File: `coreza-backend/src/engine/types/executionContext.ts`**

```typescript
export interface NodeExecutionContext {
  userId: string;
  runId: string;
  executionId: string;  // ← new: unique per event/bar execution
  workflowId: string;
  // ... rest unchanged
}
```

### 2. Thread `executionId` through WorkflowRun

Wherever the context is built (in `WorkflowRun` or the execution runtime), add `executionId`. Default it to `runId` so non-streaming paths work without changes.

Need to check how the context is constructed — likely in `WorkflowRun` or `ExecutionRuntime`. Add an `executionId` field that can be set per-event via a setter method like `setExecutionId(id: string)`.

### 3. Set `executionId` per event in WorkflowRunner

**File: `coreza-backend/src/services/WorkflowRunner.ts`**

In `processMessage()`, after `resetForNextBar(true)` and before execution:

```typescript
const executionRunId = randomUUID();
this.engine.setExecutionId(executionRunId);  // ← new method
```

This keeps `resetForNextBar()` (preserving indicator state) while making each event uniquely identifiable.

### 4. Use `executionId` in BrokerExecutor

**File: `coreza-backend/src/nodes/executors/BrokerExecutor.ts`**

```typescript
idempotencyKey = generateIdempotencyKey({
  workflowId: context?.workflowId ?? "manual",
  nodeId: node.id,
  runId: context?.executionId ?? context?.runId ?? `manual-${Date.now()}`,
  // ... rest unchanged
});
```

Uses `executionId` (unique per bar) for idempotency. Falls back to `runId` for non-streaming executions where `executionId` equals `runId`.

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/engine/types/executionContext.ts` | Add `executionId: string` field |
| `coreza-backend/src/engine/workflowRun.ts` (or equivalent) | Store and expose `executionId`, default to `runId` |
| `coreza-backend/src/engine/workflowEngine.ts` | Add `setExecutionId()` passthrough method |
| `coreza-backend/src/services/WorkflowRunner.ts` | Call `engine.setExecutionId(executionRunId)` per event |
| `coreza-backend/src/nodes/executors/BrokerExecutor.ts` | Use `context.executionId` in idempotency key generation |

