# Persistent Edit Fields and workflow variables

Author variables through **Edit Fields → Persistent ON → Execute**. A typed row named `bonus` with Number value `0` overwrites the workflow's prior `10`. Later nodes in the same execution can read `{{ $vars.bonus }}`. Persistent OFF produces normal Edit output and performs no variable writes. Saving a graph, typing and previewing never persist values.

`$vars` is a read-only, owner + workflow scoped configuration namespace, separate from Store and `$state`. No standalone Get Variable node or Settings authoring page is required. V1 persistence supports String, finite Number and Boolean; the storage contract also supports null for explicit imports. Array/Object rows remain usable with Persistent OFF and fail with an actionable diagnostic when ON. Names use `[A-Za-z_][A-Za-z0-9_]*`, at most 64 ASCII characters, excluding prototype keys. Limits remain 128 variables, 4 KB per scalar and 64 KB per snapshot. Missing references fail explicitly.

## Execution and consistency

At startup PostgreSQL verifies scope ownership and revision, including service-role calls. The optional cache Redis client reads an owner/workflow/revision-keyed immutable snapshot. Missing, poisoned, oversized or unavailable cache data falls back to SQL. SQL unavailability prevents variable-dependent startup. No Redis/SQL handle reaches the expression evaluator.

A Persistent typed Edit invocation stages all rows against the current input/expression snapshot. Duplicate/missing/reserved names, invalid types and oversized values fail before writes. One SQL transaction locks the existing owner revision row, checks the expected revision, upserts the batch and stores its idempotency receipt. Only after success does the runtime publish a new frozen copy-on-write snapshot and route Edit output. Earlier snapshots remain unchanged; following typed/generic evaluations see the committed values. Persistent commit failures abort the event even under best-effort execution so dependent trading cannot proceed. Live runner results with `success:false` are recorded as failures.

Unchanged values skip durable writes and cache operations, including repeated bars. Workers preserve their snapshot across full bar resets and release it on stop. A worker sees its own successfully committed changes immediately; edits by other executions remain invisible until restart. Two workers belonging to the same owner that write from the same revision cannot silently overwrite each other: the losing writer fails with a conflict and must restart/revalidate. There is no automatic refresh/re-evaluation retry.

Stream receipt tokens derive from stream/message/node/invocation identity, not the randomized run record ID. Exact replay returns the original receipt without another mutation. Changed replay payloads and attempts to regress a newer local revision fail safely. This protects configuration commits, not unrelated trading side effects. Receipts are stored in the existing owner revision row and retained until owner deletion; any future retention policy must respect the stream replay horizon.

Manual and cluster Execute use the same authenticated atomic commit API. The Persistent checkbox plus Execute is the intentional write action; helper text explains that it saves workflow variables. Responses carry updated snapshots separately from node output. The editor replaces its invocation snapshot and scoped preview query only for the current execution; registries are not published into graph/output history. Subsequent cluster/Loop actions share the new revision.

Backtests load a scope snapshot but use ephemeral overlays for their own Edit writes, never production SQL mutation. Persistent typed nodes bypass the compiled backtest VM and use the existing runtime. Previews only read. Distributed Parallel Loop contexts cannot carry a pinned configuration safely yet: variable-dependent runs must disable Parallel (an explicit diagnostic prevents job handoff). Sequential loops retain invocation order and snapshot publication.

Redis remains optional for configuration correctness: a 500 ms bounded cache operation failure cannot undo a committed SQL transaction. Cache payload TTL is 300 seconds with jitter by default, configurable from 30 to 3600 seconds. Singleflight remains bounded to 128 pending scope/revision loads. Metrics retain no owner, key or value labels. Live metadata records only revision strings, including the revision after own commits.

## Compatibility, migration and rollback

The upgrade migration alters the existing `workflow_variables` and `workflow_variable_revisions` tables; it creates no tables. `workflow_variables.workflow_id` separates workflow-owned values from preserved global rows (`NULL`). Existing IDs, `value_type`, timestamps and `updated_by` are retained. The existing owner revision/lock remains shared across workflows; unrelated workflow writes can therefore cause a safe revision conflict. Replay receipts live in a namespaced `commit_receipts` JSONB column on the existing revision row. RLS isolates reads; direct writes are revoked for authenticated/service roles; security-definer RPCs check both authenticated ownership and the workflow owner. Existing user-global rows and old Redis `persistent:userId:...:workflowId:...` keys are preserved. No Redis value is silently imported or allowed to overwrite SQL.

Old global values are available only for explicit read-only export at `/variables/legacy-global` (the legacy GET `/variables/` also remains). They are never merged into workflow `$vars`; no name collision precedence is inferred. Existing global write endpoints now return 405. Before enabling the new namespace for an existing strategy, export its intended global/legacy Redis values, review their workflow ownership and scalar types, enter them as typed Fixed Edit rows, and explicitly execute with Persistent ON in the intended saved workflow. An empty scoped registry is intentional; missing names fail rather than fall back to an unrelated key. Legacy row graphs keep their existing Set/Copy/Remove behavior. Mixed typed/legacy Persistent batches require explicit conversion to typed rows before using the SQL write path.

Deployment order: apply `20261012080000_workflow_variables.sql` and `20261012100000_edit_field_workflow_variables.sql` → validate SQL/RLS/worker behavior → enable `WORKFLOW_VARIABLES_ENABLED` → enable frontend `VITE_WORKFLOW_VARIABLES_ENABLED`. Both flags default off. Saved workflows need UUID IDs; transient unsaved editors cannot access persistent scopes. Do not enable the new flags until existing global users have completed the explicit workflow migration.

Rollback disables frontend authoring and new variable-dependent backend execution. Already-running workers retain their local configuration until stopped. Leave all existing variable rows and revision receipts intact; reverting to old user-global resolution is not a compatible rollback for newly authored workflow variables. Cancellation after SQL commit cannot undo that transaction; the stopped runner discards its local reference and the next runner loads the committed revision.

## Validation

From `coreza-backend`, run `jest --runInBand tests/editFieldsV2.test.ts tests/workflowVariables.test.ts tests/workflowVariableLifecycle.test.ts tests/variableContext.test.ts tests/safeExpression.test.ts tests/persistentWorkflowVariables.test.ts tests/persistentVariableExecution.test.ts tests/persistentVariableManual.test.ts tests/persistentVariableRunner.test.ts tests/executionRuntimePropagation.test.ts`.

From the root, run `jest --config tests/persistentEditFields.jest.cjs --runInBand` for the UI/editor unit coverage without the legacy test setup's database/network probe. The UI test keeps the actual layout/editor and substitutes DOM widgets/history hooks; native pointer geometry remains covered by reference insertion tests and must be checked in a browser before rollout.

SQL integration: `VARIABLES_TEST_DATABASE_URL=<empty disposable database ending _variables_test> jest --runInBand tests/integration/workflowVariables.test.ts`. It applies migrations twice and tests atomic overwrite, rollback, RLS, workflow authorization, conflicts, receipts and limits. Never target application data. An embedded PostgreSQL (PGlite) adapter was used in this workspace to execute the same tests without Docker; it does not substitute for Supabase deployment and multi-connection/live-market validation.

`node --import tsx scripts/benchmark-variables.ts` measures 10,000 in-memory reads with 128 variables, not deployed SQL/cache/startup latency. This table-reuse revision was not tested at the user’s request. Earlier validation of the separate-table design does not validate this upgrade. Deployment/RLS and live-market checks remain rollout gates.

# Review remediation evidence — 2026-10-12

The supplied review correctly identified gaps remaining after PRs #803/#804. Current dev was inspected at `6880d995877c6408b55bb8de0a8843f7010ccb78`; it included both merged implementations and the review document. Existing SQL scalar limits, safe parser, immutable startup snapshots and optional cache were already implemented. Persistent typed Edit authoring, workflow scope, transactional batches, async executor commit, same-run publication, and editor propagation were missing.

| Gap | Remediation |
| --- | --- |
| Persistent retained old typed value | `editFields.ts` gives typed rows overwrite semantics; historical legacy reads stay separate. |
| No wired SQL write boundary | `editFields.ts` stages all fields; `ControlFlowExecutor.ts` awaits `commitVariables` before output routing. |
| User-global registry exposed across workflows | Existing variable tables with workflow columns and existing RPC overloads and scope-checked snapshot/cache keys in contract/repository/service. Old global data remains read-only and explicitly exportable. |
| Multi-row partial writes / lost updates / stream replay | SQL transaction locks the existing owner revision, validates whole batch, rejects conflicts, and stores event/node/invocation receipts. |
| Worker cannot observe own commit | `WorkflowRun` atomically replaces its frozen snapshot; runtime refreshes `$vars` for each following node. No evaluator I/O. |
| Backtest writes and compiled VM bypass | Persistent typed fields force runtime fallback; backtest commits only ephemeral overlays. |
| Manual/cluster stale revision | Comparator stages/commits via the same service; editor uses a scoped lock snapshot and advances it from a separate response field. |
| Failed live run mislabeled success | Runner checks the engine's success result, records failure and final revision, and keeps stable stream event identity. |
| Competing authoring surface | Remove Settings Variables component/tab/write API; keep preview and suggestions on node fields. |
| Distributed child snapshot mismatch | Fail before Parallel Loop job handoff for variable-dependent execution; sequential execution is supported. |

Before: Edit checkbox/optional Redis callbacks and `$vars` SQL snapshots were unrelated; typed reads could reuse the previous 10. After: typed `bonus=0` is staged, one authorized SQL batch advances revision, cache invalidation is optional, and a frozen local snapshot exposes 0 to later nodes and restart. Zero, false and empty string are preserved. Invalid fields publish no new values. Variable registries remain absent from graph outputs, serialized workflow nodes and run results.

Policy decisions: user + workflow scope; explicit manual/cluster Execute writes; preview/backtest read-only with backtest overlays; String/Number/Boolean persistence only; deterministic conflict failure rather than automatic re-evaluation; legacy/global data preserved for explicit migration; no distributed Parallel Loop variable sharing in V1. These choices resolve the review document's open decisions without replacing the engine or parser.

## Historical validation of the previous separate-table revision (not rerun)

- Before edits: 86 existing targeted backend tests passed.
- After edits: 115 backend tests passed across nine suites (including actual queue execution and manual HTTP boundaries); 3 runner-boundary tests additionally passed. The final runtime/runner rerun passes 11 tests, including the added Parallel Loop guard (119 unique backend tests overall).
- UI/editor: 14 tests passed (toggle, explicit submit, scoped read-only preview/insertion, later cluster snapshot publication and cross-workflow rejection).
- SQL: all 9 existing/new integration tests passed against isolated embedded PostgreSQL. Migrations applied twice; tests exercised both namespaces, atomic rollback, zero/false/empty values, ownership/RLS, revision conflicts, exact replay and rejected replay changes. No application database was touched.
- Additional expression/drop suites: 37 passed, 19 failed. All 19 failures are in the existing `resolveReferences-parity` suite and reproduce unchanged on the clean baseline (31 passed, same 19 failed). The two parameter/drop suites pass; no unrelated resolver behavior was changed to satisfy stale expectations.
- Frontend production build with the variable flag enabled and frontend type check passed. Backend type check has the same 47 diagnostics as baseline; no new diagnostics. Whitespace validation passed.
- Local evaluator benchmark: 128 variables, 10,000 reads; P50 0.00181 ms, P95 0.003112 ms, snapshot 13,742 bytes, observed heap delta -88,456 bytes (GC-dependent). 10,000 unchanged-write/read iterations and 10,000 resets also pass with zero extra storage calls.

## Acceptance and remaining gates

The code closes the confirmed write-path and scope gaps. It is reviewable, with flags left disabled. Full production rollout acceptance remains gated on disposable Supabase/PostgreSQL multi-connection concurrency tests, a deployed live market-event/reclaim check, Redis outage testing in that topology, native browser interaction, and representative startup/write latency and heap measurements. Embedded SQL, mocked stream boundaries, unit cache outage simulations and a local evaluator benchmark do not prove those deployment properties.

The durable configuration receipt prevents duplicate configuration writes; it is not an exactly-once order-execution guarantee. Changed replay inputs fail safely. Receipt retention grows only for changed writes, resides in the owner revision row, and ends with owner deletion; define retention against the stream replay horizon before high-frequency configuration-writing strategies. Old global and Redis data require explicit migration before switching namespace semantics. These are recorded limitations, not silent fallbacks. The table-reuse upgrade above supersedes the separate-table design. No tests, build or type check were run for this revision at the user’s request.
