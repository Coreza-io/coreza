# Fix Store node erroring in live mode (rpush path)

## Symptom

In live mode the Store node writes the value to Redis (the `store:userId:...:ticker` LIST is populated) but the node is marked as errored and execution jumps straight back to OnBar, with no error text surfaced. Manual runs of the same node work and render output normally.

## Investigation step (first, before the fix)

Confirm what actually throws after `await ctx.redis!.rpush(key, serialized)` in `coreza-backend/src/services/storage/configs/store.ts`. Candidates on the live path only:
- `applyTTL(ctx.redis!, key, input.ttl)` running with a resolved template `ttl` that is `""`/`NaN` in live (Redis `EXPIRE` with a non-integer throws after the successful rpush — matches "data stored + error");
- `createSuccessOutput(result, ...)` in `StorageService.execute` failing to serialize;
- the live executor treating the returned `StandardNodeOutput` shape differently to manual runs.

Add temporary structured logging (key, ttl value + typeof, error name/message) around the `catch` in `StorageService.execute` and run one live bar to identify the branch. The error is currently swallowed into an empty message, which is itself a defect.

## Fix

1. **Never lose the error.** In `StorageService.execute`'s catch, log `error.stack` with `serviceKey`/`operation`/`key` context and build the message as `error?.message || error?.name || String(error)` so an empty message can no longer produce a blank node error.
2. **Harden TTL.** In the store config helper `applyTTL`, coerce with `Number(ttl)` and skip when the value is not a finite positive integer (covers `""`, `null`, `"undefined"` from live template resolution) instead of calling `EXPIRE` with a bad argument.
3. **Make post-write failures non-fatal.** Once `rpush` has succeeded, a TTL failure must not fail the node: wrap the TTL call so it logs a warning and the operation still returns its success payload. This removes the "stored but errored" contradiction.
4. **Surface the error to the live path.** Verify the live executor propagates a failed `StandardNodeOutput` as a visible node error rather than silently returning to OnBar; if it does not, include the storage error in the node result so the output panel shows it in live as well as manual.

## Tests

Add `coreza-backend/tests/storeNodeTtl.test.ts` covering: `rpush` with `ttl: ""` / `ttl: undefined` / `ttl: "0"` succeeds and never calls `expire`; valid `ttl: 60` calls `expire`; an `expire` rejection still yields a success result; a `rpush` rejection yields an error result whose message is non-empty.

## Technical details

Files: `coreza-backend/src/services/storage/configs/store.ts` (TTL coercion + non-fatal TTL), `coreza-backend/src/services/storage/storageService.ts` (error logging and message fallback), plus the new test. No frontend or schema changes.
