# Store node: "Added 1 member(s)" but member missing in Redis

The node reports success (`sadd`, variable `ticker`) while the Redis SET for `store:userId:<uid>:workflowId:<wid>:ticker` still shows only the older member. Cause is unconfirmed, so step 1 verifies before any change.

## Step 1 — Confirm which of the three candidates it is

1. **Different key**: log the exact key the `sadd` handler builds (userId, resolved workflowId, variableName) and compare it with the key open in RedisInsight. The handler resolves workflowId from `input.workflow_id || input.workflowId || ctx.workflowId`, and `scope: local/global` may change it — a different workflowId writes a different key that looks "successful".
2. **Different Redis instance**: the Store service uses the shared cache client unless credentials are supplied; confirm the node's connection (cache vs a user credential) points at the instance being browsed.
3. **Member serialization / no-op add**: `sadd` returns 0 when the member already exists, and the value may be stored JSON-quoted (`"AAPL"`) vs raw (`AMD`). Confirm what the handler serializes and what `sadd` actually returned.

## Step 2 — Fix per finding

- Key mismatch: make workflowId resolution explicit and consistent for local vs global scope, so read and write paths build the same key.
- Wrong instance: route the operation to the intended client and surface which one was used in the node output meta.
- Serialization mismatch: use one consistent member encoding for `sadd`/`smembers` so members round-trip and dedupe correctly.

## Step 3 — Make success honest

Return the real `sadd` result in the node output: the resolved key and the number of members actually added (`added: 0` instead of "Added 1 member(s)" when Redis added nothing), so a silent no-op is visible in the output panel.

## Technical details

Touches `coreza-backend/src/services/storage/configs/store.ts` (sadd handler, key build, serialization), `coreza-backend/src/utils/store.ts` (`buildStoreKey`, value encoding), and the storage service context that picks the Redis client. No frontend changes expected.
