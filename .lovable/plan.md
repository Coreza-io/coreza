# Consolidator Scan — production fixes (review doc remediation)

The review doc is accurate. I confirmed each open item against the merged code:

- `scanConsolidators` applies `metadata.scanGraceMs ?? options.graceMs ?? 0` unconditionally, so `BacktestSession.scan(..., { commit: false })` (no graceMs) still subtracts the node's **live** grace from the historical clock. A bucket ending exactly at the finite `endExclusiveClock` is never emitted.
- `consolidatorDeliveryReceipt` writes the receipt *after* downstream execution. `SET NX` de-dupes the receipt, not the execution — two runners can both execute.
- `orderIdempotency.cacheOrderIntent` is a plain `SETEX` after a separate `getOrderFromCache`; concurrent identical orders both pass the check.
- Only `BrokerExecutor` consumes `context.emissionId`; other side-effect executors do not.

## Fix 1 — deterministic grace policy (backtest correctness)

`consolidatorScan.ts`: add `gracePolicy?: "node" | "none"` to `ConsolidatorScanOptions`, defaulting to `"node"`.
- `"none"` → effective grace is `0`, ignoring both `metadata.scanGraceMs` and `options.graceMs`.
- Record the applied grace on the emission payload (`appliedGraceMs`) for audit.
- Keep `TimeBarConsolidator.scan` pure — grace stays an orchestration concern.

Call sites:
- `BacktestSession.ts:712` → `{ commit: false, gracePolicy: "none" }`.
- Warm-up/replay scan paths → `gracePolicy: "none"`.
- `WorkflowRunner.processConsolidatorScan` → keep `"node"` (per-node grace overrides the `CONSOLIDATOR_SCAN_GRACE_MS` fallback).
- `routes/storage.ts` manual scan → accept an optional `grace_policy` body field; default `"none"` for backtest/manual identifiers, `"node"` for live; echo the applied value in the response.

## Fix 2 — atomic emission ownership

New `claimEmissionBatch` / `releaseEmissionClaim` / `markEmissionDelivered` in `consolidatorDeliveryReceipt.ts`, plus `RedisKeys.consolidatorClaim(userId, workflowId, executionId, batchHash)`.

- `batchHash` = sha256 of the sorted `emissionId` list for one logical-clock batch.
- Before executing a batch: `SET claimKey <ownerToken> NX EX CONSOLIDATOR_CLAIM_LEASE_SECONDS` (default 120). Failure to claim → skip the batch this tick (another owner has it); do not commit state.
- On success: Lua script that verifies the claim value equals `ownerToken`, writes the delivery receipts with the long TTL, and deletes the claim — one round trip, no partial state.
- On failure: delete the claim only when the value matches `ownerToken` (Lua compare-and-delete); otherwise let the lease expire.
- `ownerToken` = `${runnerInstanceId}:${crypto.randomUUID()}`, held on `WorkflowRunner`.
- Existing behaviour preserved: an already-delivered emission is not re-routed, and its `pendingCommit` is still committed to drain in-memory state.

`WorkflowRunner.processConsolidatorScan` wraps each logical-clock group with claim → execute → mark-delivered/release.

## Fix 3 — atomic broker order claim

In `orderIdempotency.ts`:
- Replace `cacheOrderIntent` with `claimOrderIntent(userId, workflowId, idempotencyKey, broker, ownerToken)` using `SET key <json> NX EX ORDER_CACHE_TTL`. Returns `{ claimed: true }` or `{ claimed: false, existing }`.
- Extend `CachedOrder` with `ownerToken` and `updatedAt`; keep `status: pending | success | failed`.
- `updateOrderCache` becomes a compare-and-set on `ownerToken` (Lua), so a stale worker cannot overwrite another's record.
- Raise `ORDER_CACHE_TTL` handling so it is at least the consolidator receipt TTL (`CONSOLIDATOR_DELIVERY_RECEIPT_TTL_SECONDS`); take the max of the two.

In `BrokerExecutor`:
- `absent` → claim, then submit with `client_order_id = idempotencyKey` where the broker supports it (already the reverse-index assumption).
- `pending` (claim lost or stale record) → **reconcile**: look up the broker by `client_order_id`/`idempotencyKey` through the existing broker `get_order` capability. Found → cache and return that result. Not found and the record is older than `ORDER_RECONCILE_STALE_MS` → allow one resubmission; otherwise return a `ORDER_IN_FLIGHT` soft failure instead of submitting.
- `success` → return the cached broker response verbatim.
- `failed` → return the failure; resubmit only when the caller passes an explicit retry flag.
- Never turn an unknown/timeout broker outcome into a fresh submission — mark the record `pending` and leave reconciliation to the next attempt.

## Fix 4 — generic side-effect idempotency

Add `src/engine/idempotency/effectGuard.ts`:

```ts
runOnce(scope, key, fn)  // SET NX claim → run → store result; replay returns cached result
```

keyed by `context.emissionId ?? context.runId` + nodeId + a caller-supplied effect discriminator. Wire it into the executors that perform external mutations (webhook/HTTP mutation, Telegram/WhatsApp/notification, Gmail send, Store writes that are not idempotent by construction). Executors without `emissionId` fall back to current behaviour, so nothing regresses for manual runs.

## Config and docs

- `.env.example`: `CONSOLIDATOR_CLAIM_LEASE_SECONDS=120`, `ORDER_RECONCILE_STALE_MS=60000`.
- `Consolidator.json`: note that scan grace applies to live scans only and is ignored in backtest/warm-up.
- Short operator note in `coreza-backend/README.md` on in-memory restart behaviour (indicators, rolling windows, consolidator working bars do not survive a process restart) and the `ENABLE_CONSOLIDATOR_SCAN` flag.

## Tests

New/extended Jest specs (mocked Redis with real `SET NX` semantics):

1. `consolidatorBacktestGrace.test.ts` — node grace 60s, finite `endExclusiveClock` equal to the bucket end → emits under `gracePolicy: "none"`, does not emit under `"node"`.
2. `consolidatorEmissionClaim.test.ts` — two workers, same candidate → one downstream execution, one receipt; expired lease reclaimable; stale token cannot mark delivered.
3. `consolidatorReceiptDrain.test.ts` — pre-seeded receipt with uncommitted state → state commits, no downstream execution.
4. `orderIdempotencyAtomic.test.ts` — 20 concurrent identical claims → one broker submission; unknown outcome → reconcile by `client_order_id`, no duplicate.
5. `effectGuardReplay.test.ts` — retried batch → one external mutation.
6. Timer lifecycle with fake timers → no overlap, no backlog, no timer after stop.

## Sequencing

Phase A: Fix 1 + config/doc updates + test 1 (correctness, low risk).
Phase B: Fix 2 (emission claims) + tests 2–3.
Phase C: Fix 3 (broker claims and reconciliation) + test 4.
Phase D: Fix 4 (generic effect guard) + test 5.
