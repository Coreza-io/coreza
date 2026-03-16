

# Updated Plan: Live Workflow Optimizations

## Changes from Previous Plan

Three user-requested modifications:
1. Move `destroyContext` to workflow stop/completion (not per-bar)
2. Rename `LiveStrategyRunner` → `WorkflowRunner` (and `LiveStrategyManager` → `WorkflowRunnerManager`)
3. Remove `parseBar` entirely, use only `parseBarFast` everywhere

---

## 1. Move `destroyContext` to Workflow Stop/Completion

Currently `destroyContext(this.runId)` is called in three places inside `workflowEngine.ts`:
- Line 212: inside `reset()` 
- Line 903: after successful `executeOnce()`
- Line 937: after failed `executeOnce()`

Also in `AIAgentExecutor.ts` line 246 (separate concern — agent-specific context).

**Change**: Remove `destroyContext` from `executeOnce()` (lines 903 and 937) and from `reset()` (line 212). Instead, call it only when the **entire workflow lifecycle ends**:

| File | Change |
|---|---|
| `workflowEngine.ts` | Remove `destroyContext` from `reset()`, and both places in `executeOnce()`. Add a new `destroy()` method that calls `destroyContext` + any other cleanup. |
| `WorkflowRunner.ts` (renamed) | Call `this.engine.destroy()` in `stop()` method — this is when the entire streaming workflow ends. |
| `EnginePool.ts` | Call `engine.destroy()` in `evict()` — when an engine is removed from the pool. |
| `BacktestSession.ts` | Already calls `destroyContext` in its own cleanup — keep as-is. |
| `AIAgentExecutor.ts` | Keep its own `destroyContext` — it creates a separate DataContext per agent run. |

New `destroy()` method on `WorkflowEngine`:
```typescript
destroy(): void {
  DataContextManager.getInstance().destroyContext(this.runId);
  this.indicatorStateManager?.destroy?.();
}
```

---

## 2. Rename `LiveStrategyRunner` → `WorkflowRunner`

Rename the class and file, plus the manager class. Update all references.

| Old | New |
|---|---|
| `LiveStrategyRunner.ts` | `WorkflowRunner.ts` |
| `class LiveStrategyRunner` | `class WorkflowRunner` |
| `liveStrategyManager.ts` | `workflowRunnerManager.ts` |
| `class LiveStrategyManager` | `class WorkflowRunnerManager` |

**Files with references to update**:
- `workflowEngine.ts` (comment on line 229)
- `GracefulShutdownHandler.ts` (import + usage)
- `jobQueueManager.ts` (import + usage + method names `startLiveStrategy`/`stopLiveStrategy`)
- `workflowWorker.ts` (log message)

---

## 3. Remove `parseBar`, Use Only `parseBarFast`

`parseBar` does two expensive things `parseBarFast` doesn't:
- `new Date(data.time).toISOString()` — Date object allocation
- `parseFloat()` × 5 — slower than `Number()`

But `parseBar` also handles JSON string input (`typeof data === "string"` → `JSON.parse`). We need to merge that capability into `parseBarFast`.

**Change in `barParser.ts`**:
- Rename `parseBarFast` → `parseBar` (replace the old one)
- Add the JSON string handling from old `parseBar` into the new one:

```typescript
export function parseBar(data: any): Bar | null {
  if (!data) return null;

  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }

  if (data.bar) data = data.bar;

  if (typeof data !== "object") return null;

  const timestamp = data.timestamp ?? data.time;
  if (timestamp === undefined) return null;

  return {
    timestamp: typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp,
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    close: Number(data.close),
    volume: Number(data.volume ?? 0),
  };
}
```

This keeps `Number()` (faster than `parseFloat`), handles both string and object input, and handles both `timestamp` (ISO string) and `time` (epoch number) fields.

Remove `parseBarFast` export entirely.

**Files to update**:
- `BacktestExecutor.ts`: Remove the `context?.silent` ternary — just call `parseBar()` everywhere (lines 607-609, 940-942)
- `PortfolioExecutor.ts`: Already calls `parseBar()` — no change needed, just uses the new faster implementation
- Any import of `parseBarFast` → remove

---

## 4. Remaining Optimizations (from previous plan, unchanged)

These carry forward as-is:

| # | Change | Files |
|---|---|---|
| A | Batch indicator Redis writes (`sync=true` + `flushToRedis` always) | `IndicatorsExecutor.ts`, `workflowEngine.ts` |
| B | Add `quiet` flag to suppress per-node logging | `workflowEngine.ts`, `WorkflowRunner.ts` |
| C | Skip `executionOrder` and `clearIncomingEdgePayloads` when quiet | `workflowEngine.ts` |
| D | Pre-populate `indicatorKeyCache` from warmup | `IndicatorsExecutor.ts`, `InitializeIndicatorsExecutor.ts` |

---

## Summary of All Files Changed

| File | Changes |
|---|---|
| `workflowEngine.ts` | Remove `destroyContext` from `reset()`/`executeOnce()`. Add `destroy()` method. Add `quiet` flag. Batch `flushToRedis` always. Gate `executionOrder`/`clearIncomingEdgePayloads` behind `quiet`. |
| `LiveStrategyRunner.ts` → `WorkflowRunner.ts` | Rename class. Set `quiet=true`. Call `engine.destroy()` in `stop()`. |
| `liveStrategyManager.ts` → `workflowRunnerManager.ts` | Rename class to `WorkflowRunnerManager`. Update imports. |
| `barParser.ts` | Merge `parseBar` and `parseBarFast` into single optimized `parseBar`. Remove `parseBarFast` export. |
| `BacktestExecutor.ts` | Remove `parseBarFast` import and `context?.silent` ternary — use `parseBar` directly. |
| `EnginePool.ts` | Call `engine.destroy()` in `evict()`. |
| `jobQueueManager.ts` | Update imports and references to new names. |
| `GracefulShutdownHandler.ts` | Update imports and references to new names. |
| `workflowWorker.ts` | Update log message reference. |
| `IndicatorsExecutor.ts` | Set `sync=true` in `update()`. Pass `indicatorKeyCache` to init executor. |
| `InitializeIndicatorsExecutor.ts` | Pre-populate `indicatorKeyCache` during warmup. |

