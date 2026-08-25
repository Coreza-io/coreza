# Consolidator scan — production hardening round 2

I verified each finding against the current code. All seven are correct.

| Finding | Confirmed in code |
| --- | --- |
| Claim lease never renewed | `consolidatorDeliveryReceipt.ts` — `claimEmissionBatch` does a one-shot `SET NX EX 120`; there is no renew function and `WorkflowRunner` never touches the claim between claim and `markEmissionDelivered`. |
| Effect keys too broad | `effectKey(runOrEmissionId, nodeId, discriminator)` — `DataSourceExecutor` passes `store:${operation}`, `CommunicationExecutor` passes `${serviceKey}:${operation}`. No parameters, no invocation index. |
| Unknown outcomes released | `effectGuard.runOnce` catch block compare-and-deletes the claim on *any* throw, including a network timeout. |
| Binance algo reconciliation wrong | `binance/http/operations.ts:371` — `get_order_by_client_id` hits `/fapi/v1/order` with `origClientOrderId`. Algo orders are submitted to the algo endpoint with `clientAlgoId` (line 259-262), and the algo lookups (`get_open_algo_orders`, `get_all_algo_orders`) are separate operations. |
| Not all operations reconcilable | `BrokerExecutor` reconciles `place_order` and `close_position` identically; `close_position` carries no client order id for most brokers. |
| Ownership loss ignored | `updateOrderCache` returns `boolean`, but both call sites (`BrokerExecutor.ts:385`, `:424`) discard it. Credential-missing returns happen *after* the claim, leaving a `pending` record until TTL. |
| Side-effect coverage incomplete | Only `CommunicationExecutor` and the `DataSourceExecutor` store path call `runOnce`. |

## Fix 1 — claim lease renewal (High)

`consolidatorDeliveryReceipt.ts`
- Add `renewEmissionClaim(userId, workflowId, executionId, emissionIds, ownerToken)` — Lua compare-and-`EXPIRE`, returns `false` when the token no longer matches.
- Export `claimLeaseSeconds()` so callers can derive the renewal interval.

`WorkflowRunner.processConsolidatorScan`
- After a successful claim, start a renewal `setInterval` at `ceil(lease / 3)` seconds for that batch.
- Stop the interval before `markEmissionDelivered` or `releaseEmissionClaim`, and in a `finally` so it can never leak.
- If a renewal returns `false`, abort the batch: signal the engine's abort controller, stop renewing, and skip the delivery commit (the new owner will handle it).
- Wrap batch execution in `CONSOLIDATOR_BATCH_TIMEOUT_MS` (default `lease * 1000 * 5`, i.e. renewal keeps it alive but a hung batch still terminates); on timeout treat it as failure and release.

## Fix 2 — parameter-specific effect keys (High)

`effectGuard.ts`
- Replace `effectKey` with:
  ```ts
  effectKey({ scopeId, nodeId, operation, params, invocationIndex })
  // => `${scopeId}:${nodeId}:${operation}:${sha256(stableStringify(params))}${index}`
  ```
- Add a `stableStringify` helper (sorted keys, deep) so key ordering cannot change the hash.
- `invocationIndex` is an optional caller-supplied counter for legitimate identical repeats inside one emission (e.g. a loop sending the same message twice).

Call sites
- `CommunicationExecutor` — hash `{ service, operation, recipient/chatId/to, channel, subject, body/message, attachments }`.
- `DataSourceExecutor` — hash `{ provider, operation, key, field, value, ttl }`.
- Both pass the loop iteration index as `invocationIndex` when the node runs inside a loop context.

## Fix 3 — unknown-outcome handling (High)

`effectGuard.ts` — widen `StoredEffect` to `pending | complete | failed | unknown`.
- Classify the thrown error: network timeout / socket hangup / `ECONNRESET` / 5xx-without-body / aborted → **unknown**; explicit 4xx provider rejection → **failed**.
- `failed` → compare-and-delete the claim (current behaviour, retry is safe).
- `unknown` → compare-and-set the record to `{ status: "unknown", attemptedAt, error }` with the long TTL, and **do not delete**. A retry hitting an `unknown` record returns a `EFFECT_OUTCOME_UNKNOWN` failure with the original error rather than re-firing.
- Add optional `reconcile?: () => Promise<TResult | null>` to `runOnce`; when present it is called on an `unknown` record before deciding, letting providers that support lookup self-heal.
- Pass a provider idempotency key where supported (e.g. HTTP `Idempotency-Key` header for the generic HTTP/webhook path).
- Document per-effect guarantees in a table in the README (exactly-once / at-most-once / at-least-once).

## Fix 4 — Binance algo-order reconciliation (High)

- `orderIdempotency.CachedOrder` gains `orderKind: "standard" | "algo"` and `marketType`, set at claim time from the resolved params (futures + conditional/algo order type → `algo`).
- Add `get_algo_order_by_client_id` to `binance/http/operations.ts`: `GET /fapi/v1/algoOrder` (falling back to a `clientAlgoId` filter over `get_all_algo_orders` when the single-order endpoint is unavailable) keyed by `clientAlgoId`.
- `BrokerExecutor.reconcileOrder` selects the lookup operation from `orderKind` instead of always using `get_order_by_client_id`.
- Until this lands and is tested, `binance` algo orders are excluded from scan-driven live execution by the capability matrix below.

## Fix 5 — reconciliation capability matrix (High)

New `src/brokers/reconciliationCapabilities.ts`:

```ts
type ReconcileSupport = "client_id" | "algo_client_id" | "position_based" | "none";
// keyed by `${broker}:${operation}` with a per-broker default of "none"
```

- Alpaca `place_order` → `client_id`; Binance standard `place_order` → `client_id`; Binance algo `place_order` → `algo_client_id` (marked `liveScanAllowed: false` until Fix 4 ships with tests); every `close_position` → `position_based`, `liveScanAllowed: false`; unknown brokers → `none`.
- `BrokerExecutor` refuses to create an order claim for a scan-driven execution (`context.emissionId` present) when `liveScanAllowed` is false, returning `SCAN_UNSAFE_OPERATION`.
- Graph validation surfaces the same rule as a workflow warning when `ENABLE_CONSOLIDATOR_SCAN` is on, so users see it before going live.

## Fix 6 — order ownership loss (Medium)

`BrokerExecutor`
- Capture both `updateOrderCache` results. On `false`: log, re-read the canonical record with `getOrderFromCache`, and return that record's outcome (or `ORDER_OWNERSHIP_LOST` when the record is gone) — never report the local submission as authoritative.
- Move the credentials/OAuth/validation checks so any direct return after a successful claim first calls `releaseOrderClaim` (new compare-and-delete in `orderIdempotency.ts`) or marks the record `failed`, so no `pending` record survives to TTL for an order that was never sent.

## Fix 7 — side-effect coverage audit (Medium)

- Enumerate executors reachable from a scan emission and classify each: pure, naturally idempotent, guarded, reconciled, or unsupported.
- Add the guard to the remaining mutating paths found in the audit (RedisStore mutations, generic HTTP/webhook mutation operations, Gmail send).
- Record the classification in a table in `coreza-backend/README.md` next to the existing in-memory-state notes, and add a comment marker on each unguarded-but-pure executor so the classification does not silently rot.

## Tests

1. `consolidatorClaimRenewal.test.ts` — batch execution longer than the lease keeps the claim alive; renewal failure aborts the batch and never marks delivered.
2. `effectGuardKeying.test.ts` — two different recipients in one emission produce two sends; identical repeats with distinct `invocationIndex` both fire; a true replay returns the cached result.
3. `effectGuardUnknown.test.ts` — a simulated timeout leaves an `unknown` record; the retry does not re-fire and surfaces `EFFECT_OUTCOME_UNKNOWN`.
4. `binanceAlgoReconcile.test.ts` — algo order timeout reconciles via the algo endpoint with `clientAlgoId`; no duplicate submission.
5. `brokerScanCapability.test.ts` — `close_position` and Binance algo under a scan emission return `SCAN_UNSAFE_OPERATION`.
6. `orderOwnershipLoss.test.ts` — a lost claim makes the executor re-read the canonical record; a post-claim credential failure leaves no `pending` record.

## Sequencing

Phase A (blockers for live beta): Fix 1, Fix 3, Fix 6 + tests 1, 3, 6.
Phase B (correct keying): Fix 2 + test 2.
Phase C (broker safety): Fix 5 gate first, then Fix 4 + tests 4, 5.
Phase D: Fix 7 audit and README guarantee tables.
