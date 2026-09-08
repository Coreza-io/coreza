# Remove implicit `suppressDownstream` routing; require explicit If gating

The attached plan is accurate against the current code. Verified references:

- `coreza-backend/src/nodes/types.ts:97` — `suppressDownstream?: boolean` on `ControlFlags`
- `coreza-backend/src/nodes/executors/ConsolidatorExecutor.ts:46` — sets `control: { suppressDownstream: !emitted }`
- `coreza-backend/src/engine/executionRuntime.ts:304` and `:424` — early return in both standard and backtest routing
- `coreza-backend/src/backtest/compiled/vm.ts:101` — `continue` block skipping activation
- `src/nodes/Consolidator.json:25` — output description promising suppression
- Tests: `executionRuntimeSuppression.test.ts`, `compiledVmSuppression.test.ts`, `timeBarConsolidator.test.ts:114-116`

No other producer sets the flag, so removal is contained.

## New behavior

A successful Consolidator result always propagates. Held buckets still return `emitted: false` (with `workingBar`); completed buckets return `emitted: true` with `bar`. Authors who want completed-bar-only logic insert an If node checking `emitted == true` between Consolidator and downstream nodes. Failure semantics (`success: false`) and all other control flags (loop routing, parallel distribution, `sourceHandle`, `setState`, `throttleUntil`, branch) are untouched.

## Changes

1. **Contract** — `coreza-backend/src/nodes/types.ts`: delete `suppressDownstream` and its comment from `ControlFlags`. Leave everything else.
2. **Producer** — `ConsolidatorExecutor.ts`: drop the `control` field from the success return; keep state read/write and `runConsolidatorStep` untouched.
3. **Queue runtimes** — `executionRuntime.ts`: remove the early return at both line 304 (standard) and line 424 (backtest). Routing then falls through to Loop / If-Switch / standard routing as for any other node.
4. **Compiled VM** — `backtest/compiled/vm.ts`: remove the suppression `continue` block (lines 101-104), keeping the `success === false` skip above it and the timing accounting intact.
5. **Node metadata** — `src/nodes/Consolidator.json`: rewrite the output description to state that every successful execution propagates, and that completed-bar-only branches must be gated with an If on `emitted == true`.

## Tests

- `executionRuntimeSuppression.test.ts` → rename/rewrite to assert both standard and backtest runtimes leave a pending successor after any successful result, and none after `success: false`.
- `compiledVmSuppression.test.ts` → rewrite so `emitted: false` still activates the downstream instruction; add a BRANCH-based case where an If on `emitted` routes true/false correctly.
- `timeBarConsolidator.test.ts:114-116` → drop the `control` expectations, keep `emitted`/`bar` assertions.
- Add a cross-engine parity test: the same Consolidator → If(`emitted == true`) → sink graph produces identical sink activations under standard runtime, backtest runtime, and compiled VM.
- Leave all consolidator state tests (DataContext persistence, timezone/DST, anchor, warm-up, partial final bar) unchanged — they must still pass.

## Verification

- `tsgo` typecheck plus the backend jest suites (consolidator, runtime, compiled backtest).
- Final literal repo search for `suppressDownstream` must return zero matches outside this plan file.
- Run a representative 1h→4h backtest with an explicit If gate and confirm trade cadence matches the pre-change run.

## Breaking change

Saved workflows that relied on implicit suppression will now execute downstream nodes on every source bar. This is intentional. Ship a release note with the migration pattern (insert If on `emitted == true`). Do not auto-insert If nodes into existing workflows. An optional editor warning when a Consolidator connects directly to a non-conditional node can follow later — not part of this change.

## PR boundary

One focused PR: (1) contract + runtime removal, (2) metadata + test migration, (3) explicit-If parity regression. No consolidator clock/scan, state persistence, warm-up, or VM optimization work mixed in.
