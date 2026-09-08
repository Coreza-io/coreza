# Store node: bounded deque append (`rpush_bounded`)

Add one Store List operation that is the equivalent of Python's `deque(maxlen=N).append(value)` — atomic `RPUSH` + `LTRIM -N -1`. The document's design is sound and matches the existing Store patterns; the notes below are adjustments needed to fit the current code.

## Verified against the code

- `configs/store.ts:182-225` — `lpush`/`rpush` handlers: resolve `workflow_id || workflowId || ctx.workflowId`, build the key with `buildStoreKey`, serialize with `typeof value === "string" ? value : JSON.stringify(value)`, then `applyTTL`.
- `configs/store.ts:24-37` — `applyTTL` only expires on a positive integer TTL and swallows expiry failures (best-effort, value already written).
- `configs/store.ts:39-77` — `isWrongTypeError` + `runTypeSafeOperation` already produce the actionable "variable holds another data type" error. The new operation must go through this wrapper rather than inventing its own message.
- `configs/store.ts:331-345` — existing standalone `ltrim`, left untouched.
- `types.ts:38-43` — list fields block where `maxLength` belongs.
- `Store.json:114-119, 589-601` — the stream `maxLen` field already exists and is shown for `xadd`/`xadd_bulk`. **Use a separate `maxLength` key** for the deque bound so the two never collide in `displayOptions`.

## Adjustments to the document

1. **Transaction result must be inspected explicitly.** `multi().exec()` resolves even when a queued command fails — errors arrive as `[error, reply]` tuples, not a rejection. So `runTypeSafeOperation` alone will not catch a `WRONGTYPE` from inside the transaction. After `exec()`, walk the replies, and if any tuple has a non-null error, throw it — that throw then lands inside `runTypeSafeOperation` and gets converted to the friendly message. A null `exec()` result (aborted transaction) throws a plain "Store transaction aborted" error.
2. **Keep TTL out of the transaction.** The doc prefers `EXPIRE` inside `MULTI`, but current Store semantics are "TTL is best-effort and never fails the write" (`applyTTL` catches). Putting `EXPIRE` in the transaction would change that contract. Call `applyTTL` after `exec()`, exactly like `rpush` does.
3. **Return the resulting length.** `LTRIM` returns `OK`, but `RPUSH` returns the pre-trim length, so also read `LLEN` — simplest is to queue `llen` as the third transaction command and report the final length in the payload.
4. **Upper bound.** Enforce the doc's safety cap (100000) as a hard validation error, not a silent clamp.

## Changes

### 1. `coreza-backend/src/services/storage/types.ts`

Add `maxLength?: number | string;` to the list-fields block (after `index?: number;`).

### 2. `coreza-backend/src/services/storage/configs/store.ts`

Add a shared validator near `applyTTL`:

```ts
const parseMaxLength = (value: unknown): number => {
  const maxLength = Number(value);
  if (!Number.isInteger(maxLength) || maxLength <= 0 || maxLength > 100000) {
    throw new Error("maxLength must be a positive integer no greater than 100000");
  }
  return maxLength;
};
```

Add `rpush_bounded` directly after `rpush` in the LIST OPERATIONS section:

- Resolve `workflowId` and require `variableName` (same guard text pattern as `rpush`).
- `const maxLength = parseMaxLength(input.maxLength);` before touching Redis.
- Serialize `input.value` identically to `rpush`.
- Wrap the Redis work in `runTypeSafeOperation(ctx, key, input.variableName, "list", ...)`, and inside it:
  ```ts
  const replies = await ctx.redis!.multi()
    .rpush(key, serialized)
    .ltrim(key, -maxLength, -1)
    .llen(key)
    .exec();
  if (!replies) throw new Error("Store transaction aborted; please retry");
  for (const [error] of replies) if (error) throw error;
  return Number(replies[2]?.[1] ?? 0);
  ```
- After the wrapper returns, `await applyTTL(ctx.redis!, key, input.ttl);`.
- Return `{ operation: "rpush_bounded", variableName, maxLength, length, message: \`Value appended; list trimmed to latest ${maxLength}\` }`.

Leave `rpush` and `ltrim` untouched.

### 3. `src/nodes/Store.json`

- List `conditionalOptions` (line ~71): add `{ "id": "rpush_bounded", "name": "Deque Append (keep latest N)" }` right after `rpush`.
- Add `"rpush_bounded"` to the `operation` arrays of the existing `variableName` field (line ~327) and `value` field (line ~351) so both stay visible.
- New field placed next to the other list fields:
  ```json
  {
    "key": "maxLength",
    "label": "Max Length",
    "type": "text",
    "placeholder": "e.g. 8",
    "required": true,
    "description": "Keeps only the newest N items, like deque(maxlen=N).",
    "displayOptions": { "show": { "operation": ["rpush_bounded"] } }
  }
  ```
- Add `"rpush_bounded"` to the `ttl` field's operation list so TTL stays available, matching `rpush`.
- Re-run `npx tsx scripts/validate-nodes.ts`.

### 4. `coreza-backend/tests/storeDequeAppend.test.ts`

Modelled on `storeNodeTtl.test.ts` (mock `getRedisCache`, drive `storeConfig.operations.rpush_bounded.handler` with a fake redis whose `multi()` returns a chainable stub):

- Appending with `maxLength: 8` issues exactly `rpush(key, serialized)`, `ltrim(key, -8, -1)`, `llen(key)` in one `multi()`, in that order.
- Doc's worked example end to end against a real-ish in-memory list stub: start `[1..8]`, append `9`, final `[2..9]`, reported `length === 8`.
- Object values are JSON-stringified; string values pass through unchanged (parity with `rpush`).
- `maxLength` of `0`, `-1`, `1.5`, `"abc"`, `undefined`, and `100001` all reject before any Redis call (`multi` never invoked).
- A `WRONGTYPE` error inside the transaction replies surfaces the friendly "holds another data type" message, not the raw Redis text.
- `exec()` resolving `null` produces a clear aborted-transaction error.
- Valid TTL calls `expire`; invalid/absent TTL does not; a failing `expire` still returns success.
- `rpush` behaviour is unchanged (existing `storeNodeTtl` suite must still pass).

## Not doing in this PR

RedisStore parity (doc §15). If it is wanted later, extract the handler body into a shared helper first rather than copying it.

## Verification

`tsgo` typecheck, `npx tsx scripts/validate-nodes.ts`, and the backend store test suites. Manual: a Store node with Data Type List / Deque Append / Max Length 8, run 10 times, then a `lrange` Store node showing exactly the last 8 values.
