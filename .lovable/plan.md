# Complete PR #766 and fix standalone Consolidator execution context

## Objective

After running a collapsed `BacktestInit → OnBar` cluster, a downstream Time Bar Consolidator must:

- show and submit the same canonical upstream source and exact value the Input Data panel displays;
- execute a valid saved candle through its own authenticated editor-state lifecycle;
- never depend on, revive, or mutate the completed cluster run’s in-memory context;
- truthfully return a held working candle (`emitted: false`) until a later bucket input completes the prior candle;
- preserve cluster execution scope, result ownership, cancellation, pins, falsy values, and history behavior.

Full historical replay is not part of a single-node Execute. It remains a per-bar strategy run or a separately designed replay operation.

## Verified baseline and scope

The attached review targets PR #766 at commit `660794e4662e9c0f78b4d628bd1ec2114fa46946`, but the current checkout still contains the older implementation:

- `StableNodeContext` is imperative/ref-backed, `useCanonicalGraphSync` writes during render, and `InputPanel` still reads React Flow’s projected graph.
- `BaseNode` recalculates ancestry from imperative getters using displayed edge count and submits `selectedPrevNode.data.output ?? {}` instead of the store-backed value shown by InputPanel.
- `useNodeExecution` independently reads React Flow nodes/edges, uses truthy fallbacks, and sends `workflowSessionId` without an explicit execution-context mode or operation identity.
- `useClusterExecution` still has state-dependent polling, captured `currentNodeIds`, non-cancellable delay, and retry/submission ownership gaps.
- `WorkflowExecutionResult` has no `resultFinalized` or per-node outcome contract in this checkout.
- `POST /storage/consolidator` selects `runId ?? workflowSessionId ?? backtestId`, only calls `getExistingContext`, and returns 404 when the chosen process-local context does not exist.
- The Consolidator route test pre-creates its editor context, so it does not cover the first independent node Execute that fails for the user.
- `DataContextManager` stores contexts in a process-local map; its periodic cleanup only warns when the map is large and implements no expiration.
- No new database table is required for the primary fix. Existing workflow ownership can be checked through the backend repository; durable/shared editor state can use the established Redis cache with scoped keys and expiry.

Therefore implementation must include the still-missing PR #766 prerequisites plus the new Consolidator lifecycle fix. Already-correct consolidation math and scoped workflow execution must be preserved.

## Implementation plan

### 1. Lock the failing request and behavioral contract with tests

**Areas:** browser/component request capture, `coreza-backend/tests/consolidatorRoute.test.ts`

- Reproduce the exact flow: run a cluster containing BacktestInit and OnBar, leave it collapsed, select the downstream Consolidator, and click its own Execute button.
- Assert the outgoing request contains:
  - explicit mode `editor`;
  - authenticated workflow ID and editor session ID;
  - downstream Consolidator node ID;
  - workflow/configuration revision or deterministic configuration fingerprint;
  - unique operation ID;
  - resolved candle, symbol, source/target timeframe, timezone, and anchor.
- Add a failing backend test where no context is pre-seeded. A valid first editor operation must succeed and return a working candle.
- Retain a separate strict active-run test: a missing/completed `runId` must fail and must not implicitly create an editor context.
- Log only structured identity/mode/lookup/error-code fields; never log credentials or complete candle histories.

### 2. Finish the canonical graph foundation from PR #766

**Areas:** `src/contexts/StableNodeContext.tsx`, `src/pages/WorkflowEditor.tsx`, a focused canonical graph store/helper

- Replace render-time canonical ref mutation with a stable external-store snapshot and `useSyncExternalStore` subscription.
- Publish canonical nodes and edges in a layout/commit effect as one consistent document snapshot.
- Keep imperative `getNodes`, `getEdges`, and `getNodeById` access for callback-heavy paths, backed by the same canonical snapshot.
- Notify subscribers for node/edge add, remove, reconnect, workflow replacement, and semantic node-data changes; avoid ancestry rebuilds for display-only collapse and drag position changes.
- Keep historical execution views isolated on their supplied saved graph rather than the live editor graph.
- Add snapshot identity and notification-count tests.

### 3. Finish canonical InputPanel selection and live data resolution

**Areas:** `src/utils/InputPanel.tsx`, new pure input-selection helpers, execution-store subscriptions

- In live mode, traverse only canonical nodes/edges; in read-only mode, retain the saved historical graph and execution records.
- Resolve selection deterministically:
  1. retain the selected real node while it remains upstream;
  2. otherwise prefer a direct incoming Loop `done` source;
  3. otherwise choose the first deterministic upstream ancestor;
  4. otherwise clear selection.
- Never identify synthetic nodes by prefix alone; validate against canonical membership/projection metadata.
- Resolve displayed live data by own-property presence:
  1. execution-store `output`;
  2. canonical node `data.output`;
  3. intended canonical `data.input` fallback;
  4. empty state.
- Preserve explicit `null`, `0`, `false`, empty string, arrays, objects, and pinned output.
- Subscribe to execution-store updates so hydrated cluster results update an open collapsed panel immediately.
- Pass only the resolved canonical source ID into draggable field references; collapse/expand must not rewrite existing expressions.

### 4. Make BaseNode and node Execute consume the same semantic input

**Areas:** `src/components/nodes/BaseNode.tsx`, `src/hooks/useNodeExecution.ts`, shared input helpers

- Remove displayed-edge-count ancestry invalidation. Subscribe BaseNode to the canonical topology snapshot/revision so same-count reconnections, deletes, and workflow replacement recompute ancestors.
- Reuse the same source-selection resolver and live-data resolver used by InputPanel.
- Make the Execute handler receive the resolved canonical source ID/data or derive them from the shared canonical/store adapter; do not independently reconstruct a different selection.
- Replace semantic `useReactFlow().getNodes/getEdges` reads in payload building, expression identity lookup, support-node attachment, Loop edges, and BacktestInit graph serialization with canonical getters/snapshots. Keep React Flow only for visual mutations such as updating rendered node output.
- Preserve values by property presence. Remove fallbacks that replace valid `null`, `0`, `false`, empty string, arrays, or empty objects with field state or stale node data.
- Define root-node fallback explicitly instead of using `!effectiveInput` or `Object.keys` as a universal missing-input test.
- Ensure full-graph payloads contain canonical nodes/edges, never compact cluster nodes or projected boundary edges.

### 5. Introduce an explicit Consolidator execution-context request

**Areas:** frontend request types/building, `coreza-backend/src/routes/storage.ts`, route validation schema

Use a discriminated contract rather than silent ID precedence:

```text
editor:
  contextMode, workflowId, workflowSessionId, nodeId,
  configFingerprint/revision, operationId, resolved input

active-run:
  contextMode, workflowId, runId, nodeId, resolved input
```

- Reject missing mode, conflicting identity fields, malformed UUID/session/operation values, missing node identity, or incomplete configuration with stable error codes.
- For `active-run`, verify the run belongs to the authenticated user/workflow and remains active before accessing its context. Missing/completed run context stays an error.
- For `editor`, verify workflow ownership from the authenticated token and saved workflow record; never trust `userId` from the request.
- Never copy a completed cluster run ID into a downstream editor request.
- Include node ID and configuration fingerprint in the editor-state identity; two Consolidator nodes with identical settings must not share state.

### 6. Build an owned editor Consolidator state service

**Primary addition:** a backend editor-context service/adapter, with route integration

- Keep runtime/backtest `DataContext` ownership unchanged. Add a dedicated editor state lifecycle rather than weakening `getExistingContext` for active runs.
- Scope editor state by authenticated user, workflow, editor session, node, and configuration fingerprint.
- Prefer the existing Redis cache for deployment-safe continuity across API processes:
  - namespaced key through `RedisKeys`/existing execution-key conventions;
  - serialized validated Consolidator state only, not a complete `DataContext`;
  - explicit sliding or fixed TTL;
  - atomic compare/update or lock to prevent concurrent lost updates;
  - explicit reset/delete operation;
  - no persistence in Supabase and no new table.
- If Redis is unavailable under existing cache policy, return a structured state-unavailable error; do not silently create divergent per-process state.
- Validate bar and configuration before allocating persistent state.
- Store state only after a successful consolidation step.
- Bind each stored state to its owner, workflow, session, node, and config fingerprint; reject any mismatch.
- Make expiration behavior explicit: a request claiming to continue an expired series returns `EDITOR_CONTEXT_EXPIRED`; only an explicit fresh/reset request starts over.
- Add bounded TTL cleanup through Redis expiry; do not rely on `DataContextManager.cleanupStaleContexts`.

### 7. Define idempotency, reset, and source-series semantics

**Areas:** editor context service, route contract, frontend node state/control

- Treat every editor Execute as an operation with a stable client-generated `operationId` retained across transport retries.
- Atomically record the last/recent operation result with the state so retrying the same operation returns the same response without adding the bar twice.
- Apply the existing out-of-order/duplicate timestamp rules from `TimeBarConsolidator`; do not silently double volume.
- Establish deterministic series identity:
  - first valid operation starts a fresh series;
  - chronological new input advances it;
  - symbol/timeframe/timezone/anchor change creates a new fingerprint and requires a fresh/reset series;
  - a newly accepted upstream cluster run must not append automatically to the prior run’s partial bucket.
- Carry source provenance (for example accepted upstream run ID/output generation) in editor state so a changed source run can be detected without using that run’s execution context.
- Add an explicit Reset action only for the Consolidator’s editor state, with confirmation/disabled/loading feedback and a backend ownership check. Do not reset runtime/backtest state.
- Clarify the result: one 1h input normally returns `emitted: false`, `bar: null`, and `workingBar`; a fifth boundary input emits the completed 4h bucket. Never synthesize missing historical bars or flush an incomplete final bucket.

### 8. Reuse one consolidation algorithm and one output contract

**Areas:** `coreza-backend/src/engine/consolidation/consolidatorShared.ts`, `ConsolidatorExecutor.ts`, `storage.ts`, frontend error parsing

- Continue using `runConsolidatorStep` for editor route and runtime executor; do not duplicate OHLCV aggregation.
- Preserve exact timeframe-ratio validation, timezone/DST/anchor behavior, input-driven bucket completion, and `emitted/bar/workingBar` payload.
- Keep runtime state keys stable unless parity tests prove a required change. Namespace editor state outside the internal algorithm key so runtime warmup/backtest behavior is untouched.
- Return `StandardNodeOutput` consistently for success and failure, with stable codes such as:
  - `EDITOR_CONTEXT_EXPIRED`;
  - `EXECUTION_CONTEXT_COMPLETED`;
  - `EXECUTION_CONTEXT_UNAVAILABLE`;
  - `INVALID_BAR`;
  - `INVALID_CONSOLIDATOR_CONFIG`;
  - `INVALID_CONSOLIDATOR_STATE`;
  - `DUPLICATE_OPERATION_CONFLICT`.
- Preserve machine-readable code through `useNodeExecution` instead of reducing the response to a JSON-string error.
- Render `emitted: false` as a successful “Building the current 4h candle” state, not an error.

### 9. Finish descriptor-owned cluster polling and delivery

**Area:** `src/hooks/useClusterExecution.ts`

- Replace the `states`-dependent effect with a poll loop owned by one immutable accepted descriptor.
- Permit one request in flight and one cancellable delay; abort/settle both on terminal state, workflow switch, unmount, supersession, or generation change.
- Keep submitted member IDs immutable for response validation, but read current document membership from a current ref/canonical snapshot at hydration time.
- Skip deleted nodes and guard against ID reuse by also checking current workflow session/generation and, where available, submitted node identity/fingerprint.
- After every await, revalidate workflow/session/run/cluster/revision/member scope/generation before any store or UI write.
- Use descriptor-scoped cleanup so an old poll, retry, cancel, or submission `finally` cannot clear or overwrite a newer run.
- Give output retry its own AbortController/token; it reads the same run and never submits another execution.
- Preserve pending reset only after server acceptance, pin protection, fixed cadence, and current result normalization.

### 10. Finish the run-result completeness and cancellation contract

**Areas:** `WorkflowExecutionResult`, workflow runtime/worker, run repository/query service, Redis run storage, `persistedNodeResult`, cluster hydration/history

- Add versioned result metadata inside the existing `workflow_runs.result` JSON:
  - `resultFinalized`;
  - per-member `nodeOutcomes` (`executed`, `failed`, `skipped`, `cancelled`, `not-executed`);
  - `nodeResults`, `executionOrder`, timing/boundary outputs, and partial-result indication.
- Do not add a new table or column unless implementation proves the JSON envelope cannot be finalized safely.
- Distinguish:
  - terminal run with finalized complete/partial result;
  - terminal status observed before result finalization;
  - malformed/missing envelope;
  - explicitly skipped/cancelled/not-executed member.
- Hydrate all valid member entries even if a sibling is malformed; preserve explicit falsy output and pins.
- Keep a bounded poll/backoff for terminal-but-not-finalized results, then expose retryable output-unavailable state without inventing not-executed markers.
- Preserve active cancellation ownership: queued work removed before start may finalize empty cancellation; active work remains cancelling until its worker persists available snapshots and final outcome. Prevent cancellation acknowledgements from overwriting worker-finalized results.
- Keep database and Redis result envelopes equivalent and preserve all fields during synchronization.
- Existing `workflow_runs` scope columns and validation trigger remain sufficient; no database migration is planned for this feature.

### 11. Preserve owned backtest and cluster boundaries

**Areas:** Backtest executor/session, execution runtime, workflow worker

- Verify compiled and dynamic backtest paths execute Consolidator per ordered bar using the run-owned context.
- Keep `BacktestInit` owned batch awaiting, latest snapshot collection, and duplicate-routing suppression.
- Preserve partial snapshots on failure and cancellation.
- Handle an already-aborted parent signal before attaching listeners.
- Ensure cluster scope containing only BacktestInit and OnBar never executes the downstream Consolidator.
- Keep manual stepping behavior unchanged and clean listeners/sessions once on all exits.

### 12. Automated test matrix

**Frontend helper/component tests**

- Canonical snapshots, commit-phase publication, notification counts, and history isolation.
- Expanded/collapsed upstream order and real IDs for `BacktestInit → OnBar → Consolidator`.
- Selection repair, Loop `done`, same-count reconnect, deletion, two collapsed clusters, unrelated-member exclusion, and 20 toggles.
- Store-only hydrated output is exactly what Execute submits.
- `null`, `0`, `false`, empty string, arrays, objects, pins, and drag-reference IDs remain intact.
- Canonical full-graph/support-node payload serialization contains no synthetic IDs.

**Cluster hook tests with fake timers/deferred promises**

- One non-overlapping request per interval; cancelled delay settles.
- Terminal hydration once; malformed/partial/finalized outcomes.
- Delete or replace member during run does not receive stale output.
- Workflow switch, retry switch, generation supersession, and late submission/poll/retry responses are ignored and release only their own controls.
- Retry performs only status GET; failed prepare/execute keeps prior useful output.

**Consolidator route/service tests**

- Fresh editor Execute succeeds without pre-created `DataContext`.
- Completed cluster then downstream Execute uses a fresh editor state namespace.
- Missing/completed active-run context remains a structured error with no implicit creation.
- Cross-user/workflow/session/node access is rejected; two tabs and two identical Consolidator nodes remain isolated.
- First four hourly bars hold; fifth emits; one saved bar never invents history.
- Same operation retry is idempotent; a distinct duplicate/out-of-order bar follows defined validation.
- Config/source-generation change requires reset/fresh series; Reset is scoped and authorized.
- TTL expiry, Redis unavailable, API restart, and multi-instance concurrency have deterministic behavior.
- Success/error responses conform to `StandardNodeOutput` and preserve stable codes.

**Owned runtime/integration tests**

- Compiled/dynamic full strategy parity, final snapshots, no duplicate routing, failure partial output, cancellation before/during initialization and mid-run, already-aborted signal, manual stepping, and cluster boundary isolation.
- Database/Redis status paths return equivalent finalized-result metadata; owner access succeeds and cross-user access fails.

**Real browser acceptance**

1. Build and save `BacktestInit → OnBar → Time Bar Consolidator`; cluster only the first two nodes.
2. Run and collapse the cluster; keep the Consolidator Input Data panel open.
3. Confirm real canonical options/data remain stable through collapse, rename, movement, and repeated toggles.
4. Select the saved OnBar candle and Execute the Consolidator.
5. Confirm the first valid candle succeeds as a held `workingBar`, with no missing-context error and no completed-run resurrection.
6. Retry the same operation/network response and confirm no double count; send chronological bars until the boundary and confirm the expected completed bucket.
7. Reset/change configuration/new upstream run and confirm clean isolation.
8. Verify delete-during-cluster-run, workflow navigation, pinning, cancellation/failure, and retry-output cannot write stale results.

### 13. Delivery and verification gates

1. Add failing reproductions for fresh editor context and panel-versus-submitted-input mismatch.
2. Land canonical graph/InputPanel/BaseNode/useNodeExecution parity.
3. Land explicit editor context contract, Redis-backed lifecycle, idempotency, reset, and structured outputs.
4. Land current-membership cluster hydration and descriptor-owned polling/retry.
5. Land result finalization/cancellation parity and owned-runtime integration coverage.
6. Run focused frontend/backend tests, full repository lint/type/build/module-boundary checks, and the real Playwright scenario.
7. Reproduce and resolve the reported Docker `npm run build` heap OOM separately; it is a CI resource failure, not proof of feature type correctness. Re-run build-and-scan to green.

## Acceptance criteria

- A fresh standalone Consolidator Execute succeeds without any pre-seeded process-local run context.
- A completed cluster’s ID is never reused as mutable editor state.
- The panel source/value and submitted source/value are identical in expanded and collapsed modes.
- No synthetic cluster ID enters selection, payload graphs, references, or result delivery.
- Editor state is authenticated, workflow/session/node/config scoped, expiring, resettable, idempotent, and safe across API instances.
- One 1h candle truthfully yields a working 4h candle; history is never fabricated.
- Active-run missing contexts remain strict errors, and cluster boundaries remain unchanged.
- Polling/retry cannot overlap, leak, lock controls, or write into deleted/replaced nodes or sessions.
- Finalized results distinguish executed, failed, skipped, cancelled, not-executed, incomplete, and unavailable states while preserving pins and falsy output.
- All focused, integration, browser, full-build, and CI gates pass.
