# Fix Store node erroring in live (compiled plan rejects async executors)

## Root cause (confirmed by the debugger screenshot)

In `coreza-backend/src/backtest/compiled/adapters.ts`, `buildExecAdapter` calls `executor.execute(...)` and, if the result is a thenable, immediately returns:

```text
{ success: false, data: null,
  error: `Compiled plan requires synchronous executor for category ${executor.category} (node ${node.id})` }
```

`DataSourceExecutor.execute` (which handles the Store node) returns a Promise. So on the compiled/live path the Redis `rpush` fires and succeeds — the LIST is populated — but the adapter has already discarded the pending promise and marked the node failed with an error the UI does not surface, and the engine continues back to OnBar. Manual runs use the non-compiled path, await the promise, and work.

## Plan

1. **Let the compiled adapter await async executors.** Make `ExecFn` able to return `NodeResult | Promise<NodeResult>` and have `buildExecAdapter` return the promise instead of synthesising the error. Update the compiled plan runner to `await` the exec result (awaiting an already-resolved value is effectively free for the synchronous executors, so hot-path indicator nodes keep their behaviour).
   - Keep the `syncCapable` notion: executors that declare `syncCapable` and return non-promises stay on the fast path; only genuinely async results are awaited.
2. **Preserve warm-up policy.** `enforceWarmupPolicy` / `ctx.isWarmingUp` handling must wrap the awaited result, so a suppressed or rejected node still short-circuits before the async call.
3. **Surface the failure instead of swallowing it.** Wherever the compiled runner receives `success: false`, ensure the error reaches the node result/output panel and the live socket, so a future adapter-level failure is visible rather than a silent hop back to OnBar.
4. **Harden the Store handler** (secondary, from the same trace): in `services/storage/configs/store.ts`, coerce `ttl` with `Number()` and skip `EXPIRE` when it is not a finite positive integer, and make a TTL failure non-fatal after a successful `rpush`. In `storageService.ts`, log `error.stack` and fall back to `error.name`/`String(error)` so an empty message can never produce a blank node error.

## Tests

- `coreza-backend/tests/compiledAdapterAsync.test.ts`: an async executor resolves through `buildExecAdapter` with its real result (no "requires synchronous executor" error); a sync executor still returns synchronously; warm-up suppression still short-circuits before execution.
- `coreza-backend/tests/storeNodeTtl.test.ts`: `rpush` with empty/invalid `ttl` never calls `expire`; valid ttl calls `expire`; `expire` rejection still yields success; `rpush` rejection yields a non-empty error message.

## Technical details

Files: `coreza-backend/src/backtest/compiled/adapters.ts` (+ its `ExecFn` type and the compiled plan runner that invokes it), `coreza-backend/src/services/storage/configs/store.ts`, `coreza-backend/src/services/storage/storageService.ts`, plus the two test files. No frontend or schema changes.
