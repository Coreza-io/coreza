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

Live activations use only their local registry. There is no SQL variable snapshot service, global-variable export endpoint, checkpoint worker, ownership probe, checkpoint reporting or handoff path. The bounded activation registry stores only single-use activation markers to detect interrupted workers. Incomplete live stops still wait for active events and block replacement through the existing runner manager.

Deploy the scoped backend and matching editor together. Database migration history and existing stored rows are untouched; runtime code does not load or update those retired variable records.

No tests, build or type check were run for this change, as requested. Obsolete SQL/cache tests were removed and existing lifecycle/HTTP fixtures were adjusted to the scoped service.
