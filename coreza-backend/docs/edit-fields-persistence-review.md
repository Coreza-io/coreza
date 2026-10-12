# Review remediation evidence — 2026-10-12

The supplied review correctly identified gaps remaining after PRs #803/#804. Current dev was inspected at `6880d995877c6408b55bb8de0a8843f7010ccb78`; it included both merged implementations and the review document. Existing SQL scalar limits, safe parser, immutable startup snapshots and optional cache were already implemented. Persistent typed Edit authoring, workflow scope, transactional batches, async executor commit, same-run publication, and editor propagation were missing.

| Gap | Remediation |
| --- | --- |
| Persistent retained old typed value | `editFields.ts` gives typed rows overwrite semantics; historical legacy reads stay separate. |
| No wired SQL write boundary | `editFieldVariables.ts` stages all fields; `ControlFlowExecutor.ts` awaits `commitVariables` before output routing. |
| User-global registry exposed across workflows | Additive scoped SQL tables/RPCs and scope-checked snapshot/cache keys in contract/repository/service. Old global data remains read-only and explicitly exportable. |
| Multi-row partial writes / lost updates / stream replay | SQL transaction locks scope revision, validates whole batch, rejects conflicts, and stores event/node/invocation receipts. |
| Worker cannot observe own commit | `WorkflowRun` atomically replaces its frozen snapshot; runtime refreshes `$vars` for each following node. No evaluator I/O. |
| Backtest writes and compiled VM bypass | Persistent typed fields force runtime fallback; backtest commits only ephemeral overlays. |
| Manual/cluster stale revision | Comparator stages/commits via the same service; editor uses a scoped lock snapshot and advances it from a separate response field. |
| Failed live run mislabeled success | Runner checks the engine's success result, records failure and final revision, and keeps stable stream event identity. |
| Competing authoring surface | Remove Settings Variables component/tab/write API; keep preview and suggestions on node fields. |
| Distributed child snapshot mismatch | Fail before Parallel Loop job handoff for variable-dependent execution; sequential execution is supported. |

Before: Edit checkbox/optional Redis callbacks and `$vars` SQL snapshots were unrelated; typed reads could reuse the previous 10. After: typed `bonus=0` is staged, one authorized SQL batch advances revision, cache invalidation is optional, and a frozen local snapshot exposes 0 to later nodes and restart. Zero, false and empty string are preserved. Invalid fields publish no new values. Variable registries remain absent from graph outputs, serialized workflow nodes and run results.

Policy decisions: user + workflow scope; explicit manual/cluster Execute writes; preview/backtest read-only with backtest overlays; String/Number/Boolean persistence only; deterministic conflict failure rather than automatic re-evaluation; legacy/global data preserved for explicit migration; no distributed Parallel Loop variable sharing in V1. These choices resolve the review document's open decisions without replacing the engine or parser.

## Actual validation results

- Before edits: 86 existing targeted backend tests passed.
- After edits: 115 backend tests passed across nine suites (including actual queue execution and manual HTTP boundaries); 3 runner-boundary tests additionally passed. The final runtime/runner rerun passes 11 tests, including the added Parallel Loop guard (119 unique backend tests overall).
- UI/editor: 14 tests passed (toggle, explicit submit, scoped read-only preview/insertion, later cluster snapshot publication and cross-workflow rejection).
- SQL: all 9 existing/new integration tests passed against isolated embedded PostgreSQL. Migrations applied twice; tests exercised both namespaces, atomic rollback, zero/false/empty values, ownership/RLS, revision conflicts, exact replay and rejected replay changes. No application database was touched.
- Additional expression/drop suites: 37 passed, 19 failed. All 19 failures are in the existing `resolveReferences-parity` suite and reproduce unchanged on the clean baseline (31 passed, same 19 failed). The two parameter/drop suites pass; no unrelated resolver behavior was changed to satisfy stale expectations.
- Frontend production build with the variable flag enabled and frontend type check passed. Backend type check has the same 47 diagnostics as baseline; no new diagnostics. Whitespace validation passed.
- Local evaluator benchmark: 128 variables, 10,000 reads; P50 0.00181 ms, P95 0.003112 ms, snapshot 13,742 bytes, observed heap delta -88,456 bytes (GC-dependent). 10,000 unchanged-write/read iterations and 10,000 resets also pass with zero extra storage calls.

## Acceptance and remaining gates

The code closes the confirmed write-path and scope gaps. It is reviewable, with flags left disabled. Full production rollout acceptance remains gated on disposable Supabase/PostgreSQL multi-connection concurrency tests, a deployed live market-event/reclaim check, Redis outage testing in that topology, native browser interaction, and representative startup/write latency and heap measurements. Embedded SQL, mocked stream boundaries, unit cache outage simulations and a local evaluator benchmark do not prove those deployment properties.

The durable configuration receipt prevents duplicate configuration writes; it is not an exactly-once order-execution guarantee. Changed replay inputs fail safely. Receipt retention grows only for changed writes and currently ends with workflow deletion; define retention against the stream replay horizon before high-frequency configuration-writing strategies. Old global and Redis data require explicit migration before switching namespace semantics. These are recorded limitations, not silent fallbacks. Migration and rollback instructions are in `workflow-variables.md`.
