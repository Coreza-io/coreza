

## Analysis

The suggestion proposes creating an `ExecutionResult` type in `engine/types.ts`. However, **this type already exists** as `WorkflowExecutionResult` in `coreza-backend/src/engine/types/executionError.ts` (line 15-21), and it's already in the correct layer.

### What's already correct
- `WorkflowExecutionResult` lives in `engine/types/` — right ownership
- `ExecutionError` lives in `engine/types/` — right ownership
- `NodeResult` lives in `nodes/types.ts` — right ownership
- `WorkflowRunner` imports from `engine/` — correct dependency direction

### What could improve

**1. Rename `WorkflowExecutionResult` → `ExecutionResult`**
The `Workflow` prefix is redundant since it's already in the `engine/` module. However, this touches 49 references across 3 files — high churn, low value. **Skip.**

**2. Strengthen `result` typing from `Record<string, unknown>` to `Record<string, NodeResult>`**
Current: `result?: Record<string, unknown>` — loses type info.
Proposed: `result?: Record<string, NodeResult>` — typed node results.
This is a genuine improvement. The `buildResult()` method in `workflowRun.ts` already populates this with `NodeResult` objects, so the runtime shape already matches. Making the type explicit catches bugs at compile time.

**3. Add timing metadata (`startedAt`, `finishedAt`, `durationMs`)**
Useful for future performance tracking and UI timelines, but `timing` field already exists on `WorkflowExecutionResult`. Adding wall-clock timestamps is a separate concern — **skip for now**.

## Plan

### File: `coreza-backend/src/engine/types/executionError.ts`

**Change 1**: Import `NodeResult` from `nodes/types` and update `WorkflowExecutionResult.result` type:

```typescript
import { NodeResult, WorkflowEdge, WorkflowNode } from "../../nodes/types";

export interface WorkflowExecutionResult {
  success: boolean;
  result?: Record<string, NodeResult>;  // was Record<string, unknown>
  executionOrder?: string[];
  error?: ExecutionError;
  timing?: Record<string, { avgMs: number; totalMs: number; count: number }>;
}
```

One line change, one import addition. No renames, no churn. The runtime already produces `NodeResult` objects — this just makes the compiler aware.

### No other files change

- `WorkflowRunner` already uses `WorkflowExecutionResult` via the engine's return type — no import changes needed
- `workflowRun.ts` already returns `NodeResult` objects in the result map — no logic changes
- `WorkflowEngine.execute()` signature stays the same

