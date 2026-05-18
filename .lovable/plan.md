# Why per-node timing shows for only some nodes

## Review of the previous fix

The earlier plan was implemented correctly:

- `coreza-backend/src/engine/workflowRun.ts` — `buildExecutionResult()` and `buildFailureResult()` now include `timing: this.runtime.getNodeTiming()` in the persisted payload.
- `src/hooks/useExecutionHistory.ts > getNodeExecutions()` — reads `payload.timing?.[nodeId]?.totalMs` instead of the old "total / N" averaging trick.

Real per-node durations now flow end-to-end. The screenshot confirms it: `getBrokerBalance 264ms`, `createPortfolio 2ms`. That part works.

## Why other nodes show no badge

Two separate causes are at play.

### Cause 1 — Sub-millisecond timings are rounded to 0 and hidden

In `useExecutionHistory.ts` the duration is stored as:
```text
durationMs: Math.max(0, Math.round(timing[nodeId]?.totalMs ?? 0))
```

The backend measures with `performance.now()` which returns fractional milliseconds. Fast nodes — `Switch`, `syncFills`, `getPosition`/`getOpenOrders` (often a cache hit), `updatePortfolioValue` (an in-memory write), `noOpenOrder` — typically take 0.05–0.4 ms. `Math.round(0.3) = 0`.

Then `NodeWrapper.tsx` hides the badge with this guard:
```text
{readOnly && executionDuration !== undefined && executionDuration > 0 && (...)}
```

So any node faster than ~0.5 ms disappears, which is exactly the pattern in the screenshot: the slow IO nodes (broker call, portfolio create) show badges; the fast in-memory nodes don't.

### Cause 2 — Backtest runtime never records timing at all

`coreza-backend/src/engine/executionRuntime.ts > BacktestExecutionRuntime.routeNodeResult` overrides the base method but drops the timing block:

```text
protected override routeNodeResult(node, result, _t0, meta) {
  this.executionOrder.push(node.id);
  this.store.setNodeResult(node.id, result);
  // (no nodeTiming.set call — t0 is even prefixed with _ to mark it unused)
  ...
}
```

The base class (used by Standard/manual/live runs) does record into `nodeTiming`, which is why the current manual run shows real timings. But **every backtest run will report 0 for every node** because the override never populates the map.

## Fix

### Frontend (`src/`)

1. **`src/hooks/useExecutionHistory.ts > getNodeExecutions()`** — stop rounding away sub-ms values. Keep the original float (or round to 2 decimals) so the badge can render meaningful sub-ms timings:
   ```text
   const totalMs = timing[nodeId]?.totalMs;
   durationMs: typeof totalMs === "number" ? +totalMs.toFixed(2) : undefined,
   ```
   Using `undefined` (instead of `0`) for the "no timing recorded" case keeps the existing "hide badge when missing" behaviour for old runs while letting real sub-ms values through.

2. **`src/utils/NodeWrapper.tsx`** — update the badge guard and formatter to handle sub-ms values:
   ```text
   {readOnly && typeof executionDuration === "number" && (
     <div className="...badge classes...">
       {executionDuration < 1
         ? `${executionDuration.toFixed(2)}ms`   // e.g. "0.32ms"
         : executionDuration < 1000
           ? `${Math.round(executionDuration)}ms` // e.g. "264ms"
           : `${(executionDuration / 1000).toFixed(1)}s`}
     </div>
   )}
   ```
   Dropping the `> 0` guard means truly-zero (skipped/never-executed) nodes still get no badge because their `durationMs` is `undefined`, not `0`.

3. **`src/hooks/useExecutionHistory.ts`** — update the `NodeExecutionLog.durationMs` type from `number` to `number | undefined`, plus any consumer (`NodeExecutionInspector.tsx`) that formats it (mirror the same `< 1` branch there for consistency).

### Backend (`coreza-backend/`)

4. **`coreza-backend/src/engine/executionRuntime.ts > BacktestExecutionRuntime.routeNodeResult`** — record timing the same way the base class does, before the routing branch:
   ```text
   const elapsed = performance.now() - t0;
   const prev = this.nodeTiming.get(node.id) ?? { totalMs: 0, count: 0 };
   prev.totalMs += elapsed;
   prev.count += 1;
   this.nodeTiming.set(node.id, prev);
   ```
   Rename the parameter back from `_t0` to `t0`. With this, backtests get the same per-node timings as manual/live runs (and since backtests iterate the same node many times across bars, `totalMs` correctly accumulates the full cost of that node across the whole backtest, while `count` lets the UI later show "avg per bar" if we ever want that).

## Verification

- Re-run the same workflow. Every node now shows a badge: fast nodes display `0.12ms` / `0.4ms`, slow ones still show `264ms` / `2.1s`. None are silently hidden.
- Run a backtest from the Backtests page and open the executions view: per-node badges appear with cumulative time across all bars, instead of empty/0 everywhere.
- Old runs (persisted before the previous fix) still render with no badge because `timing` is absent → `durationMs` is `undefined` → guard hides it.

## Out of scope

- We are not introducing per-call vs per-bar averaging in the UI yet. `count` and `avgMs` are already in the payload; surfacing them is a follow-up if needed.
