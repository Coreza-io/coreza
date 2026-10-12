# Review remediation plan — Edit Fields persistent variables (2026-10-12)

Status: PLAN ONLY; do not implement changes until approved.
Repository: Coreza-io/coreza | target branch: dev.
Goal: Complete the originally requested Edit Fields Persistent → PostgreSQL → Redis optional cache → live worker in-memory `$vars` flow without rebuilding the existing variable infrastructure.

## 0. Review verdict and scope
Existing read-only `$vars` implementation (PostgreSQL revision RPCs, VariableRepository, VariableSnapshotService, runtime snapshot, parser, frontend preview and tests) is a useful foundation. But it is distinct from the existing Edit Fields Persistent implementation (Redis-only workflow-scoped `NodeStoreV2` keys). The new Settings → Variables UI is not the desired authoring surface. This is not accepted as complete until Persistent Edit Fields writes become available via `{{ $vars.bonus }}` in the SAME execution and after restart.

**First inspect current dev HEAD again before implementation**; code can change after the review. Distinguish verified code gaps from hypotheses. Capture baseline test results and avoid unrelated changes.

## 1. Confirmed review observations / files
- `src/nodes/Field.json` already provides Persistent checkbox and typed field rows. Preserve this UI.
- `coreza-backend/src/nodes/logic/editFields.ts`: typed-row persistence branch recently added, but `legacyPersistentRead: true` can prefer an earlier value; typed rows and legacy rows require explicit separate semantics.
- `coreza-backend/src/nodes/executors/ControlFlowExecutor.ts`: existing execution checks for setPersistentValue callbacks and rejects Promise writes in the synchronous executor; `$vars` read context is passed separately.
- `coreza-backend/src/engine/executionRuntime.ts`: exposes runtime variable snapshot as `variables`; verify whether `getPersistentValue`/`setPersistentValue` are supplied on ALL execution paths (review showed no wiring in inspected factory).
- `coreza-backend/src/engine/nodeStoreV2.ts` and `coreza-backend/src/infra/redisKeys.ts`: old persistence uses `persistent:userId:...:workflowId:...:key` in Redis; not the new SQL registry.
- `coreza-backend/src/variables/VariableRepository.ts`, `VariableSnapshotService.ts`, `contract.ts`: existing per-user SQL registry, revisioned cache and bounded scalars. Preserve logic unless scope change explicitly necessary.
- `coreza-backend/src/engine/workflowRun.ts`, `workflowEngine.ts`, `services/WorkflowRunner.ts`: initialize immutable snapshot for live worker before Redis stream consumption; ensure persistence update affects only later evaluations.
- `supabase/migrations/20261012080000_workflow_variables.sql`: current SQL schema/RPCs are per-user and handle one variable mutation with revision checks. For Edit Fields multi-field atomicity, a batch mutation RPC may be necessary.
- `src/components/settings/VariablesSettings.tsx`, `src/pages/Settings.tsx`: undesired parallel authoring UI. Don't delete before checking for other dependencies/compatibility.
- `src/hooks/useVariableSnapshot.ts`, `src/hooks/useNodeReferences.ts`, `src/hooks/useFieldPreview.tsx`: retain preview and variable selection features; authoring should be Edit node only.

## 2. Decisions to lock before coding
1. **Scope:** default persistent Edit variables are scoped to user + workflow, matching legacy key semantics. Implement SQL/RPC and cache keys for workflow scope; no accidental cross-workflow access. If existing shared Settings variables are in use, retain a separate explicitly named read-only global namespace during migration or provide a backward-compatible fallback only after documenting precedence and avoiding collisions. Prefer one workflow variable namespace for V1.
2. **Writes:** Persistent ON means an explicit write when the Edit node actually runs, not when a workflow is saved or previewed. Persistent OFF means unchanged normal Edit Fields output with no write.
3. **Typed semantics:** for V2 rows, evaluating `bonus=0` must write 0, replacing old value 10; do NOT inherit legacy read-before-write. Preserve legacy semantics for historical rows unless opted into migration.
4. **Consistency:** PostgreSQL is source of truth. Redis is optional read-through/invalidation cache. Worker-local `$vars` is an immutable copy-on-write snapshot. When Edit node commits a batch, publish new local values only after successful DB commit; following nodes in that run see them. Earlier already-evaluated nodes do not change.
5. **Failure:** no trading action based on uncommitted variables. If DB write fails, the Edit node fails and downstream dependent actions do not execute; preserve Run All fail-fast and cluster error handling. Do not rely on silent best-effort mode.
6. **Concurrent writes:** use expected revisions + one SQL transaction per Edit invocation. Concurrent conflicting writers explicitly fail/retry using deterministic policy, never lost updates. Define behavior for two live strategy workers sharing same workflow.
7. **Backtests/manual/cluster:** prevent unwanted production persistent modifications during backtests and previews. Explicitly choose manual/cluster write policy and test it; V1 recommendation: previews and backtests are read-only with ephemeral overlays, live Edit node writes persist, manual/cluster persistence requires clearly intentional execution/confirmation consistent with existing product semantics.
8. **Types:** typed Edit node offers string/number/boolean/array/object; current SQL registry only accepts scalar/null. Choose either bounded JSON typed values and safe parser access with resource limits, OR reject unsupported persisted type before executing node with actionable error. Do not silently truncate/coerce.
9. **Missing name:** `$vars.missing` should throw a clear reference error, not return an unrelated Redis key or `undefined`.

## 3. Execution architecture

Initial live startup:
`SQL revision check -> revision-keyed Redis cache HIT or SQL snapshot -> immutable worker-local values`.
Existing `WorkflowRunner.start()->engine.initialize()` runs BEFORE stream polling.

At persistent Edit node execution:
1. Evaluate all typed rows with current expression context; validate name/type/value, reject duplicates and reserved prototype keys.
2. Stage all changes as an ordered batch. If one fails, write nothing.
3. If no value actually changes, skip SQL and Redis operations.
4. Commit batch using owner+workflow permission, expected revision, atomic RPC, idempotency token (run/event/node/invocation) for Redis-stream reclaim/retry.
5. Cache invalidation/update of new revision key; do not block correctness on Redis availability.
6. Publish a new frozen local snapshot after DB success. Subsequent nodes resolve from local `$vars` synchronously, zero Redis/SQL calls per expression.
7. Keep snapshot across `resetForNextBar(true)`; release on worker shutdown/restart. New worker loads latest revision.
8. On conflict, fail safely or perform a bounded refresh-and-revalidate retry only if semantics are deterministic; never silently change value.
9. If remote edits occur while runner is live, they remain invisible until restart by default; exception is the live worker's own successfully committed Edit-node writes.

## 4. Minimal engineering sequence

### Phase A — reconfirm and trace
Trace every invocation of `applyFieldRows`, all `NodeExecutionContext` factories, `setPersistentValue`, `getPersistentValue`, `executeFromEntries`, route preview handling, frontend `Execute` click. Generate exact call graphs for live, backtest, manual, cluster and Run All. Verify no unawaited async operations; inspect current deploy flags. Capture baseline tests.

### Phase B — storage unification
Create a minimal additive SQL migration for workflow-scoped variables and transactional multi-variable write with revision and idempotency safeguards; maintain owner+workflow authorization (service role calls must validate owner/workflow) and RLS. Reuse `VariableRepository`, `VariableSnapshotService`, contract and existing Redis cache client. Design explicit migration from old Redis-only persistent keys. Do not erase legacy keys automatically or silently import stale Redis values over committed SQL data. Track revision only; don't log values.

### Phase C — executor write path
Introduce a narrow async persistence boundary around Edit Fields execution (or a deferred, awaited commit orchestration), without changing sync expression evaluator signatures. Validate/coerce first, commit all fields atomically, then publish output and local snapshot; errors must stop dependency-chain execution. Keep nonpersistent/legacy paths backwards compatible.

### Phase D — evaluation + preview
Ensure one scoped `$vars` object reaches every evaluator: typed Edit Fields, generic fields, manual/cluster, Run All, backtests and live. Expression preview remains read-only; no implicit DB write on typing. Keep autocomplete/cursor insertion consistent with existing editor behavior. Don't add a standalone Get Variable node.

### Phase E — UI cleanup
Use existing screenshot layout: Persistent ON, Field Name, Type, Value, Execute. Improve helper text only if needed. Remove new Settings → Variables authoring UI/route only AFTER existing user global variables are safely migrated or otherwise preserved. Retain read-only variable suggestions/inspection where helpful. No separate Variables page or new node.

### Phase F — deployment
Migration → backend feature flag → tests → frontend enablement. Add compatibility flag for legacy Redis state only when necessary. No unsafe force push and no main-branch modifications; PR against `dev`.

## 5. Required automated tests
- Edit Persistent OFF: produces ordinary output, zero DB/Redis writes.
- Edit Persistent ON: `bonus = 0` creates zero (not null/undefined), `$vars.bonus` returns 0 later in same live event.
- Edit updates existing `bonus = 10` to `0`: returns new 0; no legacy read-before-write override.
- 3 Edit fields with one invalid type: zero rows committed, no snapshot publication.
- Repeat unchanged values across 10,000 bars: zero additional durable writes; local expression reads have zero network calls.
- New worker restart sees committed value; `resetForNextBar(true)` retains current local snapshot.
- DB down during write: Edit fails; no new $vars value exposed; dependent order node not executed.
- Redis down but DB works: startup fallback and persistence succeed according to cache policy.
- Two workflows under same user with same `bonus` have different values; two owners isolated in SQL/RLS, Redis keys, preview and execution.
- Two workers concurrent update same key: conflicts/idempotency/retry behavior deterministic.
- Redis stream reclaim/double execution does not repeat committed mutation.
- Backtest/preview do not modify production persistent state; manual/cluster behavior matches documented policy.
- Typed row and legacy row migrations, fixed/expression modes, scalar type roundtrips, negative values, zero, false, empty string, null if supported.
- Nested/copy/reference syntax still passes safeExpression tests.
- Node failure prevents trading downstream in Execute All mode; test both fail-fast and relevant best-effort behavior explicitly.
- UI test: Persistent toggle, type, field name, Execute, expression autocomplete and preview of `{{ $vars.bonus }}`.
- Cache poisoning, unexpected keys, oversize snapshots, auth failures and revision conflict tests.

## 6. Acceptance gates
**P0 (block rollout):** Edit Fields Persistent ON writes authoritative variable with awaited atomic commit; `$vars` same-run read and restart recovery; errors cannot allow downstream trading based on uncommitted value; scope/auth isolation.

**P1 (before full release):** cache invalidation/conflict behavior, deterministic live updates and zero-I/O hot path, explicit backtest/manual rules, Redis migration story, UI redundancy cleanup, tests.

**P2 (follow up):** variable inspector / discovery ergonomics, richer JSON types if not included, metrics/benchmarks.

Validation: run typecheck, build, existing workflow/expression/editFields suites, new DB integration on disposable DB, integration live market-event test, Redis outage simulations, and representative latency/heap benchmark. Require actual logs/test reports and exact file diffs before calling it accepted.

## 7. Minimal diff guardrails
Do not replace existing execution engine, safe parser, cache client, workflow graph or node naming. Avoid side effects in previews. Never expose SQL/Redis handles to expression evaluator. Do not introduce new Settings-based variable editor or Get Variable node. Reuse revisions/feature flags, extend repository/migration with least additive changes, keep legacy data intact until migrated. Code changes must be isolated and backed by regression tests.

## 8. Reviewer deliverables
1. Gap-to-file mapping with root causes and all affected execution modes.
2. Before/after data flow and semantics (including zero/false and legacy behavior).
3. Exact scoped diff proposal + migration/rollback.
4. Tests and benchmarks with actual passing/failing output.
5. Remaining risks and acceptance verdict.
