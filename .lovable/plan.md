# Fix Store node erroring in live — opt-in async, sync fast path untouched

## Root cause (confirmed by the debugger screenshot)

`coreza-backend/src/backtest/compiled/adapters.ts` → `buildExecAdapter` calls `executor.execute(...)`; when the result is a thenable it discards it and returns `Compiled plan requires synchronous executor for category ...`. `DataSourceExecutor` (which serves the Store node) is async, so the `rpush` still lands in Redis while the node is marked failed and the engine hops back to OnBar with no visible error.

## Approach: keep the synchronous hot path, allow async only where declared

Do **not** make every node await. Instead:

1. **Per-executor opt-in.** `INodeExecutor` already carries `syncCapable`. Treat `syncCapable === false` (or absent) as "may return a promise". `DataSourceExecutor` currently declares `syncCapable = true` while returning a promise — that lie is what the adapter is catching. Set it to `false`.
2. **Two adapter shapes at compile time.** In `buildExecAdapter`, branch once on `executor.syncCapable`:
   - sync executors (Indicators, Compute, IF, Portfolio, …) keep today's exact code path — no promise checks in the hot loop, zero added overhead;
   - async-declared executors return the promise, and the compiled plan's node-step awaits only these nodes.
3. **Async nodes stay off the per-bar hot path by policy.** Only categories that genuinely do I/O (DataSource/Store, Broker HTTP, AI) may opt in; keep the "requires synchronous executor" error for any executor that declares `syncCapable = true` yet returns a thenable, so a future regression is still caught loudly instead of silently.
4. **Runner change is minimal.** The compiled runner's exec call becomes `const r = execFn(...); const res = isAsyncNode ? await r : r;` where `isAsyncNode` is a boolean precomputed per node at compile time — a property read, not a promise check.
5. **Warm-up policy unchanged.** `enforceWarmupPolicy` still short-circuits before `executor.execute`, so suppressed/rejected nodes never start async work.
6. **Surface failures.** Ensure a `success: false` from an async node reaches the node result/output panel and the live socket rather than a silent return to OnBar.

## Secondary hardening in the Store handler

- `services/storage/configs/store.ts`: coerce `ttl` with `Number()`, skip `EXPIRE` unless it is a finite positive integer, and make a TTL failure non-fatal once `rpush` has succeeded.
- `services/storage/storageService.ts`: log `error.stack` with `serviceKey`/`operation`, and use `error?.message || error?.name || String(error)` so a node error can never be blank.

## Tests

- `coreza-backend/tests/compiledAdapterAsync.test.ts`: an executor with `syncCapable: false` resolves its real result through the adapter; a `syncCapable: true` executor returning a promise still produces the explicit "requires synchronous executor" error; a sync executor returns without awaiting; warm-up suppression short-circuits before execution.
- `coreza-backend/tests/storeNodeTtl.test.ts`: empty/invalid `ttl` never calls `expire`; valid ttl does; `expire` rejection still yields success; `rpush` rejection yields a non-empty error message.

## Technical details

Files: `coreza-backend/src/backtest/compiled/adapters.ts` and its `ExecFn`/`CompiledExecContext` types plus the compiled plan runner (precomputed `isAsyncNode` flag), `coreza-backend/src/nodes/executors/DataSourceExecutor.ts` (`syncCapable = false`), `coreza-backend/src/services/storage/configs/store.ts`, `coreza-backend/src/services/storage/storageService.ts`, and the two test files. No frontend or schema changes.
