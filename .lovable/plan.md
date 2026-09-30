# Complete manual cluster execution parity

## Objective

Treat a cluster as a visual folder whose Execute control performs the same normal editor action as clicking Execute on each eligible member, serially in dependency/control order.

```text
Canonical editor document + current drafts
                 │
                 ├─ individual Execute ─┐
                 └─ cluster coordinator ┴─ editor-owned normal-node action

Explicit Run All ── existing historical/batch workflow execution
```

BacktestInit initializes once, OnBar advances one manual bar/symbol step, and downstream nodes consume that fresh result. A folder click must never become historical Run All merely because the nodes are grouped. No new cluster queue, database schema, worker session, or output format is required.

## Verified implementation state

- Cluster execution is already frontend-local, serial, cancellable, and guarded by a session lock. It no longer submits a queued cluster workflow.
- The normal action is still a callback registered by each rendered node hook. Collapsed members remain mounted as invisible runtime hosts, but a newly pasted/restored node can still race its first registration; execution is not yet independent of rendering.
- Schedule discovery reads canonical `data.values`, while field edits are mirrored after 50 ms. An immediate expression edit can therefore produce a payload from current hook state but a schedule from stale canonical state.
- The cluster request carries `allowedNodeIds`, generation, and lock token, but the hook adapter drops scope and lock information before payload construction and listener setup.
- The actual If response (`data.true/data.false`) and Switch response (primitive `data`) are not decoded correctly. Branch reachability also traverses attachment edges.
- Loop planning drops every dependency entering a Loop, not only its feedback edge. The coordinator does not choose between `loop` and `done`, so supported manual Loop behavior is incomplete.
- Cluster Execute acquires the shared lock; individual Execute and Run All do not. Run All also does not check that lock internally. Undo/redo, paste/import/restore, direct cluster title edits, and some delayed mutations are not uniformly blocked.
- Redis-backed, authenticated, session/node/config-scoped Consolidator state with TTL, idempotency, and shared consolidation math is already present and should be retained.
- Canonical/render projection isolation, targeted runtime-host repair, restoration repair, and projected replacement filtering are implemented correctly. The remaining visibility gap is end-to-end browser coverage, not another snapshot scrubber.
- Backtest sessions currently attempt plan compilation in the constructor, while manual OnBar uses `nextBar(true)` and explicit `/backtest/run` owns `runAll()`. Eager compilation is unnecessary for manual cursor stepping but is separate from cluster ordering correctness.

## Implementation plan

### 1. Lock behavior with contract-level regressions

Add failing tests before refactoring:

- actual HTTP If true/false envelopes and Switch match/fallback envelopes;
- attachment edges excluded from branch reachability and reconvergent main paths retained;
- genuine upstream dependency into Loop is preserved, and `loop` versus `done` selects only one path;
- immediate expression/credential edits affect both schedule and payload;
- newly created, pasted, or restored nodes execute before any component registration effect;
- cluster/individual/Run All overlap, Stop, navigation, and delayed-response races;
- collapse → update → expand/Dissolve/history/reload restores visible interactive members.

Use these as migration gates so extraction does not silently alter existing node validation, credentials, pins, references, listeners, or output behavior.

### 2. Correct control-result and edge semantics

Update the decoder to recognize only established contracts:

- direct boolean/string and direct `{true,false}` forms retained for existing callers;
- `{success, data: {true, false}}` for If;
- `{success, data: <case-or-fallback-string>}` for Switch;
- established `data.result`, top-level `result`, and `output` primitive wrappers.

Do not recursively unwrap arbitrary business objects. Return a typed result distinguishing a valid selected handle, a valid terminal branch with no connected edge, and malformed control output.

Build branch starts and reachability from main edges only, using the existing edge-semantics helper and captured Switch settings. Preserve a reconvergent node when the selected path can still reach it. Reject unsupported joins in preflight before any action runs.

### 3. Replace hook callback registration with an editor-owned action

Move the executable body of `useNodeExecution` into a non-React service that resolves a node by canonical ID and receives explicit dependencies:

- immutable graph/settings snapshot and current node definition;
- authenticated request client and workflow/editor session identity;
- selected input mapping, references, credentials, pins, and execution data;
- canonical patch/output publisher and execution-store adapter;
- allowed member IDs, lock token, AbortSignal, and execution generation;
- run-local outputs and listener/consolidator runtime services.

Keep the typed outcomes `success`, `failed`, `cancelled`, `pinned`, `skipped`, and `listener-started`, including exact falsy values. Node buttons, `WorkflowExecutor`, and the cluster coordinator must call this same service. React hooks remain UI adapters only.

Migrate one behavior family at a time—validation/request construction, pins, standard requests, Edit Fields/references, BacktestInit/OnBar, Loop, Consolidator, and listeners—using parity tests. Remove `registerEditorNodeAction`, callback capture, no-op unregister behavior, and direct mutation of hook-owned `data.output`/`data.pinnedOutput` only after all callers use the editor service.

### 4. Create an authoritative draft and run snapshot

Add an editor-owned draft registry keyed by session and node, with synchronous publish/flush. Field, selected-input, credential, expression, and tool-mode edits update this registry immediately; the existing delayed canonical mirror may remain for rendering/persistence but cannot define execution correctness.

At cluster start, in this order:

1. acquire the session execution lock synchronously;
2. flush current drafts;
3. capture cluster membership, canonical nodes/edges, definitions, values, credentials, selected sources, pins, and execution generation;
4. validate topology and compile the schedule from that same snapshot;
5. capture outside input/reference values without executing or mutating their owners;
6. seed a run-local result map with those boundary values.

After each member succeeds, publish its normal output and update the run-local map before resolving the next member. Thus member results are fresh while outside boundary values remain frozen for the run.

### 5. Enforce cluster membership through every execution boundary

Thread the immutable member set into payload construction and every nested invocation path. Before invoking a node—or changing its input, output, status, listener state, or execution-store entry—verify it is in scope.

- Outside main nodes may provide frozen boundary input/reference values only.
- Classify tools/attachments using existing edge semantics plus the effective `__isTool` draft value.
- In-scope attachments are supplied to their owner but are not independently double-executed.
- If an owner requires an executable attachment outside the folder, fail preflight with the owner and attachment named; never silently include or execute it.
- Listener startup returns `listener-started`; later callbacks retain session generation and member scope, and discard writes after reset/navigation or scope expiry.
- Keep Consolidator state scoped by authenticated user, workflow, editor session, node, and configuration. Continue using the shared consolidation algorithm and Redis TTL/idempotency behavior; reset on the established session/reset lifecycle.

Add byte-for-byte before/after assertions proving outside canonical and runtime state is unchanged.

### 6. Implement a bounded manual Loop contract

Represent a manual Loop step with an explicit selected continuation (`loop` or `done`) in the shared action outcome.

During preflight, identify the validated feedback edge separately from ordinary incoming prerequisites. Never skip all dependencies whose target is Loop. Support only the topology already recognized by cluster validation: one Loop boundary, one body path from `loop`, validated feedback to the Loop, and completion through `done`.

The coordinator executes only the selected continuation and must not independently repeat a node already dispatched inside the Loop action. Preserve input-array selection, cursor/aggregation state, empty input behavior, and completion output. Reject nested Loops, parallel entries, ambiguous feedback, unsupported reconvergence, or boundary escape before the first side effect.

### 7. Unify locks, cancellation, and stale-response protection

Use one session execution coordinator for individual Execute, cluster Execute, and Run All:

- acquire synchronously before any await and release in `finally` on every terminal path;
- cluster member calls inherit the owner token instead of reacquiring;
- reject all overlapping entry points, including rapid double clicks;
- Stop aborts the current supported request and prevents the next member; completed outputs remain;
- fence canonical/store/listener writes both before and after awaits using session plus generation;
- invalidate active generations and runtime continuations on workflow navigation, restore, or reset;
- prevent stale catch/finally handlers from replacing current cluster status.

While locked, block structural or execution-relevant changes: membership/create/Dissolve/delete, edge changes, undo/redo, cut/paste, import/version/execution restore, tool mode, and title/note edits if those edits enter the captured document. Recheck inside delayed toast actions. Permit expand/collapse and visual movement because neither changes the captured execution plan.

Record a terminal outcome for every eligible member: completed, selected-path skipped, dependency-blocked after failure, or cancelled. Never invent output for nodes that did not execute.

### 8. Preserve manual backtest behavior and defer strategy preparation

Keep mode selection based on the existing entry point—editor node/cluster actions are manual; only explicit Run All is batch. Do not introduce a redundant cluster execution-intent field.

Refactor BacktestSession so manual initialization can fetch bars, initialize broker/session state, and perform the established indicator/Consolidator warmup without eagerly compiling the full strategy. Prepare the engine/compiled plan lazily when explicit Run All or another strategy-running operation needs it. An existing manual session must still be promotable to explicit Run All.

Audit constructor and reset-time compilation as well as post-warmup compilation. Preserve asynchronous compiled instructions, Loop fallback, and both seed and intentional workflow-replay warmup contracts. Normal compiler ineligibility should be a concise fallback diagnostic, not an error. Do not mark Store synchronous or make Loop compiler-eligible merely to suppress diagnostics.

Tests must prove: BacktestInit initializes once; first cluster OnBar advances exactly one step; a later individual OnBar advances the same session; Consolidator and Compute consume the fresh step; cluster execution never calls historical replay; explicit Run All remains historically identical.

### 9. Keep canonical/display isolation and complete visibility acceptance

Retain the current design: canonical nodes are the only mutable document; collapsed nodes and compact folder nodes are render-only projections. Keep the narrow repair for positively marked runtime hosts and preserve legitimate styles, intentional hidden behavior, values, pins, outputs, positions, and edges.

Do not add redundant history/snapshot filtering where canonical state is already used by construction. Do not remove hidden runtime hosts until editor-owned actions and listener lifecycles are fully independent of mounted node components; that cleanup is a separate final simplification.

Upgrade the browser fixture to exercise the real editable canonical paths:

1. verify expanded members are visible and interactive;
2. collapse and apply output, error, field, pin, listener, and execution-status updates;
3. expand and assert computed visibility, pointer events, focusability, controls, positions, and edges;
4. repeat and Dissolve;
5. repeat around undo/redo;
6. save/reload and confirm the same canonical IDs, data, pins, edges, and visibility;
7. execute the same members individually, expanded, and collapsed and compare order, requests, outputs, and manual backtest cursor movement.

### 10. Cleanup and verification

After all callers migrate, remove only proven-unused callback-registry and cluster-only queued/polling remnants. Keep shared workflow queue, history, persistence, full backtest, and live execution code used by Run All or other callers. No database migration is planned.

Run focused frontend unit/integration tests, backend Jest suites for control/backtest/Consolidator behavior, TypeScript checks, node-definition validation, build/lint checks appropriate to each package, and Playwright acceptance. Record actual commands and outcomes; source inspection or a pre-existing healthy preview is not test evidence.

## Acceptance criteria

- Cluster Execute is equivalent to serial normal Execute clicks over eligible members, with deterministic dependency/control ordering.
- Actual If/Switch envelopes choose the correct main path; attachment edges cannot affect branch skipping.
- Supported Loop steps choose only `loop` or `done`; unsupported topology fails before side effects.
- Never-mounted nodes execute from current editor-owned drafts, and immediate edits determine both schedule and payload.
- Outside values are frozen; outside nodes never execute or mutate; attachments/listeners obey scope.
- Individual, cluster, and Run All cannot overlap; Stop/failure preserve completed results and prevent later actions.
- Navigation/reset blocks stale canonical, execution-store, and listener writes.
- BacktestInit initializes once, OnBar advances once, and only explicit Run All performs historical execution.
- Collapse/update/expand/Dissolve, undo/redo, and save/reload always restore visible interactive members.
- Full-workflow queues, persistence, output contracts, and established warmup behavior remain unchanged.
