# Persistent Edit Fields and workflow variable lifetimes

`$vars` is a read-only scalar namespace, separate from Store and `$state`. **Persistent** on typed Edit Fields remains the write switch. A successful execution stages the whole batch, validates scalar and aggregate limits, then publishes one immutable snapshot. Missing keys keep the existing expression diagnostic: execute an initializer before its first reader, including the first live event or backtest warm-up.

| Entry point | Initial values and lifetime |
| --- | --- |
| Manual editor, upstream node execution, Cluster Execute | Empty at editor-session creation. Successful actions share values until workflow/account change, import, reload or editor disposal. Each tab has a separate session. |
| Editor Execute All | A fresh empty batch for every accepted invocation. Shared across that batch's loops and backtest bars. Success, failure or Stop closes it and restores the separate manual-session preview. |
| Server Run All / backtest | Empty per WorkflowRun/backtest session; immutable local overlays survive bar/loop resets and are released by existing run/session teardown. |
| Live | Empty per runner activation, retained across events. Stop settles the active event before teardown. Loss of the worker interrupts variable-dependent activation; activate again and execute its initializer. |

Values never enter graph serialization, history, node output or pins. Persistent OFF, legacy Edit rows, Store, `$state`, overwrite behavior and sequential Loop execution retain their behavior. Distributed Parallel Loop remains disallowed for variable-dependent execution. Limits remain 128 keys, 64 ASCII characters per name, 4 KB per scalar, and 64 KB per snapshot.

## Editor scope protocol

Editor requests carry `variableScope` (session UUID, manual/batch mode, batch UUID when applicable, creation time) plus a revision. The server derives the owner from authentication and verifies saved workflow access. Scope identity is owner + workflow + session + mode + batch; creation time cannot evade a close. Authoritative values are never accepted from clients.

`GET /variables/snapshot` reads that scope without allocating or extending it. `POST /variables/scope/open` creates an empty scope on first variable-related execution. `touch` renews existing active state only; `close` atomically discards values and leaves a closed marker even when racing the first open. A continued closed/expired scope receives 410; missing scope metadata requires a refresh. No SQL fallback or automatic reseeding is allowed. POST and GET node actions carry the same checked context (GET uses `X-Workflow-Variable-Context`).

Shared Redis holds one bounded record per scope with atomic revision comparison and at most 128 invocation receipts, with a 256 KiB total receipt budget. Receipts retain the original evaluation snapshot and request fingerprint so an identical expression retry does not evaluate against its own earlier commit. Snapshots remain opaque JSON in Redis Lua to preserve JavaScript numeric precision. Matching retries are scope-local and cannot recreate a closed/expired scope; changed retries or competing revisions fail. A 24-hour inactivity TTL covers abandoned tabs and missed closes. Only execution renews it, with an hourly heartbeat during an active variable-using lock, including long-running steps. Idle previews do not renew it. Normal teardown clears the matching client query and invocation state immediately and closes with an authenticated keepalive request; existing generation/lock guards reject late publication. Redis failure blocks variable-dependent editor actions.

## Server and rollout

All new server modes use the existing local overlay, allocated only by the first successful typed Persistent Edit commit. Startup and reads do not allocate a variable snapshot; reads before initialization keep the missing-variable diagnostic. The Parallel Loop restriction is determined from the graph even before any variables exist. There is no per-tick variable Redis/SQL work and no legacy SQL snapshot or commit on the active runtime path. Existing destroy/finally, pooled reset, backtest release and live stop paths release the registry.

New live write-behind admissions are disabled even if `LIVE_VARIABLE_WRITE_BEHIND_ENABLED` is set. The checkpoint classes, worker and SQL records remain for pre-cutover fenced stop/handoff and recovery. A legacy owned scope blocks new live activation. New ephemeral activations never read checkpoint values, checkpoint their RAM, or hand values back to workflow rows. An activation admission marker prevents a replacement worker from silently reconstructing lost variable state. Incomplete stops retain their recovery/admission state and cannot be treated as completed teardown.

Deploy the scoped backend and matching editor together. Stop/handoff existing owned live scopes before cutover; resolve required recovery before replacement. Existing workflow SQL rows, caches, receipts and checkpoint records are preserved outside the active namespace. No purge, schema migration or automatic value copy is needed. Explicit legacy-global export remains at `/variables/legacy-global` (and legacy GET `/variables/`).

No tests, build or type check were run for this lifetime change, as requested.

---

The following records describe earlier persistence implementations and their historical validation; they do not define the current lifetime policy.

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
