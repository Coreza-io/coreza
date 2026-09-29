# Make cluster execution match sequential manual node execution

## Goal

The cluster Run button must behave like the user manually pressing Execute on each eligible node inside the cluster, in dependency order, once per click.

For a cluster containing `BacktestInit → OnBar`:

1. `BacktestInit` initializes a backtest session once and returns its normal `ready` output.
2. `OnBar` advances that session by exactly one manual bar/symbol step and returns that candle.
3. No historical replay and no `BacktestSession.runAll()` occurs.
4. Nodes outside the cluster never execute.
5. Both node outputs appear in their normal output panels.

The asynchronous cluster run record and queue may remain for ownership, cancellation, status, and result delivery. Being queued or having a `runId` must not change manual node semantics.

## Confirmed cause

The current cluster path is already compiled and queued with `executionMode: "manual"`, a cluster scope, entry activations, and `allowedExecutableNodeIds`. However, `BacktestInit` currently decides whether it is manual using `!context.runId`. Every queued cluster has a durable `runId`, so it is incorrectly treated as batch execution and calls `session.runAll()`.

This is an identity-versus-behavior bug: `runId` identifies and tracks an execution; it must not select backtest behavior.

There is a second parity requirement. The standalone editor executes `BacktestInit` through `/backtest/init`, then executes `OnBar` through `/backtest/onbar`, where `session.nextBar(true)` advances one manual step. The scoped workflow engine currently routes the initialization result into the regular `OnBar` executor, whose existing path formats an already-supplied bar rather than advancing the session. Removing `runAll()` alone would therefore not produce full editor parity.

## End-to-end implementation

### 1. Make the existing execution mode authoritative

Use the existing `executionMode` contract; do not add another execution-intent field.

```text
manual:
  individual editor Execute
  cluster Execute

backtest:
  explicit Run All / full historical replay

live:
  active live workflow execution
```

- The cluster planner and queue submission already set `executionMode: "manual"`; preserve that value end to end.
- Any node or cluster launched from the editor must remain `manual`, even though the queued cluster has a durable `runId`.
- Only the explicit backtest Run All path may invoke historical batch replay.
- Remove behavior inference from identifiers: `runId`, `executionId`, and `workflowSessionId` identify state; they do not select execution behavior.
- Keep the browser unable to promote a cluster request to `backtest`; the server derives and enforces `manual` mode for cluster scope.

### 2. Propagate and enforce existing manual mode without weakening cluster boundaries

Verify the existing mode survives every layer:

```text
cluster Run button
  → POST /workflows/:id/execute with cluster scope
  → saved-revision cluster plan (`manual`)
  → workflow run record and queue job (`manual`)
  → worker (`manual`)
  → executeWorkflow / WorkflowRun
  → runtime NodeExecutionContext (`manual`)
  → BacktestInit and OnBar
```

- Keep `executionMode` typed through the queue contract, workflow options, runtime options, and node context.
- Preserve it in loop child/continuation jobs and recovery paths.
- Reject or normalize any cluster job that arrives with a non-manual mode rather than allowing a cluster to become batch execution.

Keep these existing protections unchanged:

- saved workflow revision and ownership validation;
- deterministic cluster membership and internal edges;
- boundary input/reference snapshots;
- credential recovery and validation from the owned saved node configuration;
- `allowedExecutableNodeIds` checks during enqueue, execution, and routing;
- fail-fast behavior, idempotency, cancellation, and finalized run results.

Do not use `runId`, `executionId`, `workflowSessionId`, trigger name, or node name as a hidden substitute for the existing execution mode.

### 3. Correct `BacktestInit` behavior

Refactor `BacktestExecutor.executeBacktestInit` so initialization and historical replay are separate decisions.

For `executionMode: "manual"`:

- validate ownership and required configuration;
- recover and validate the selected credential before creating side effects;
- fetch/prepare the configured historical data and warm-up state exactly as standalone manual initialization does;
- create and initialize one `BacktestSession` and simulated broker;
- return the normal BacktestInit output with `mode: "manual"` and `status: "ready"`;
- do not call `session.runAll()`;
- do not attach `ownedNodeResults` or `suppressRouting`, because the outer scoped runtime must route the initialization output to the next cluster member;
- retain the initialized session after successful completion so an included or later manually executed `OnBar` can advance it.

For `executionMode: "backtest"`:

- preserve the current awaited `session.runAll()` path;
- preserve cancellation wiring, latest-node snapshots, partial snapshots on failure, finalization, `ownedNodeResults`, and duplicate-routing suppression.

Replace `const isManual = !context?.runId` with `context.executionMode === "manual"`. Keep `runId` available strictly for run identity, result ownership, cancellation, and context isolation.

### 4. Make cluster `OnBar` perform exactly one editor step

Extract a shared authenticated/session-owned manual-step operation used by both the `/backtest/onbar` route and the engine’s `OnBar` handling.

When `OnBar` runs under `executionMode: "manual"`:

- resolve `backtest_id` from the immediately upstream BacktestInit result using the normal parameter resolver;
- look up the initialized session and verify it belongs to the authenticated user and workflow before advancing it;
- call `session.nextBar(true)` exactly once;
- return the same standardized output shape as standalone OnBar, including `BarSeries`, `barIndex`, symbol progress, `isLast`, and total bars;
- route that one output to the next internal cluster node once;
- if the session is already finished, return the same terminal result as standalone OnBar without restarting or replaying it.

When OnBar receives an actual bar inside `executionMode: "backtest"`, preserve the current hot-path transformation and do not call the manual-step operation. This prevents recursion when `runAll()` drives the strategy graph per candle.

Do not duplicate session stepping logic between the route and executor. The shared operation must enforce ownership, missing-session handling, concurrent-step conflict, and output normalization consistently.

### 5. Preserve general cluster execution semantics

- Start from the compiled cluster entry activations and execute eligible members through internal main edges in deterministic dependency order.
- Execute each ordinary eligible node at most once for this one-shot cluster invocation, subject to established branch behavior; skipped branches remain explicitly skipped.
- Attachment/tool nodes remain attached capabilities and are not independently invoked.
- Pinned nodes remain non-executing and provide their pinned outputs unchanged, including falsy values.
- Nodes outside the cluster may provide explicit boundary/reference snapshots but must never be executed or mutated.
- Keep existing Loop/control-node semantics unchanged in this focused fix; do not make backtest `runAll()` the mechanism for traversing a cluster.
- A cluster containing only BacktestInit initializes and stops.
- A cluster containing `BacktestInit → OnBar` initializes and advances one step.
- A cluster containing `BacktestInit → OnBar → Indicator/Compute/...` advances one step and runs each reachable downstream member against that one OnBar output.
- A cluster containing OnBar with a valid boundary `backtest_id` advances the existing session once; a missing, expired, foreign, or completed-invalid session returns a structured error.

### 6. Session lifecycle, failure, and cancellation

- A successful manual initialization keeps the session available, matching standalone editor behavior.
- Re-running a cluster containing BacktestInit creates a fresh initialization and replaces the prior session through the existing workflow/node session scope behavior; it then advances only the new session if OnBar is included.
- Cancellation before or during initialization stops the cluster run and cleans partially created resources.
- Cancellation during a manual OnBar step is checked before and after the step; never start another step.
- A downstream node failure preserves already-produced BacktestInit/OnBar snapshots in the finalized run result and does not trigger historical replay.
- Do not auto-finalize the whole backtest after one manual step. The explicit `/backtest/run` Run All/finalize controls retain ownership of that behavior.
- Prevent concurrent cluster/manual OnBar actions from advancing the same session twice; return the existing step-in-progress conflict deterministically.

### 7. Result delivery and UI behavior

Keep the current queued run lifecycle in the cluster control:

- save the workflow first and submit the saved revision;
- show preparing, queued, running, cancelling, completed, failed, and cancelled states;
- poll the owned run and validate workflow, cluster, revision, members, session generation, and run identity;
- hydrate each submitted member’s finalized result into the execution store;
- display BacktestInit’s `ready` result and OnBar’s single candle in their respective output panels;
- mark genuinely skipped/not-executed members without inventing output;
- preserve pins and exact falsy values;
- allow output retry to re-read results only, never execute the cluster again.

No new button or mode selector is required: the cluster Run button always means editor-style one-shot execution. Full historical replay remains an explicit backtest Run All action.

### 8. Database and API compatibility

No database schema migration is required. Continue using the existing `workflow_runs` record, cluster scope columns, saved node/edge snapshots, cancellation timestamps, and JSON result envelope.

- Keep the public execute request compatible; derive and enforce `executionMode: "manual"` server-side for `scope.kind === "cluster"`.
- No new request field, database column, or persisted intent is required.
- Recovery must preserve the existing `executionMode`; a validated cluster scope always defaults to `manual`.
- Older non-cluster jobs retain their current behavior.

## Test plan

### Backtest executor and session tests

- BacktestInit with a cluster run ID and `executionMode: "manual"` initializes once, reports `ready`, and never calls `runAll()`.
- The same node with `executionMode: "backtest"` still awaits `runAll()`, collects owned snapshots, suppresses duplicate routing, and cleans its owned session.
- A run ID alone has no effect on execution behavior.
- Direct editor initialization remains initialization-only.
- Missing credentials fail before backtest/session side effects; a valid saved credential works in cluster and standalone paths.

### Scoped engine integration tests

- `BacktestInit → OnBar` executes both nodes once and `nextBar(true)` exactly once.
- The OnBar result is the first expected candle/symbol step, not the final historical candle.
- `BacktestInit → OnBar → Compute` runs Compute once with that exact OnBar output.
- BacktestInit-only cluster performs zero bar steps.
- OnBar-only cluster advances an existing owned session once.
- A second cluster click with BacktestInit creates a fresh session and again returns only its first step.
- A downstream node outside the cluster never executes.
- Batch workflow execution still processes every historical bar and does not double-route owned results.
- Cluster and manual endpoint outputs match structurally for BacktestInit and OnBar.

### Security, lifecycle, and result tests

- Cross-user/workflow session access is rejected.
- Revision mismatch, changed membership, missing boundary values, malformed credentials, and invalid scope fail before execution.
- Cancellation before initialization, during data loading, and during a step produces finalized partial outcomes without starting further nodes.
- Concurrent steps return a conflict and do not move the cursor twice.
- Queue retry/idempotency does not initialize or step twice.
- Recovery preserves `manual` mode for cluster runs.
- Database and Redis result paths preserve BacktestInit and OnBar outputs, execution order, node outcomes, and terminal status.

### Frontend and browser acceptance

1. Save a workflow containing BacktestInit, OnBar, and at least one downstream node.
2. Cluster BacktestInit and OnBar, then click the cluster Run button.
3. Confirm BacktestInit shows `ready` and OnBar shows exactly the first candle/symbol step.
4. Confirm the run completes quickly and does not progress through the historical range.
5. Confirm no node outside the cluster runs.
6. Expand/collapse the cluster and verify both outputs remain visible and selectable.
7. Run a downstream node manually using the hydrated OnBar output.
8. Run the cluster again and verify a fresh initialization plus one step, with no stale output or duplicate advance.
9. Separately use the explicit full backtest Run action and confirm it still processes all bars.
10. Verify cancel, retry-output, workflow navigation, and reload do not apply stale results.

## Delivery order

1. Add failing tests proving a cluster run ID incorrectly triggers `runAll()` and proving cluster OnBar does not currently perform one manual step.
2. Enforce the existing `executionMode: "manual"` across cluster queueing, recovery, continuations, runtime, and node execution.
3. Separate BacktestInit initialization from batch replay.
4. Extract the shared one-step OnBar operation and use it from both standalone and cluster execution.
5. Verify scoped routing, output finalization/hydration, cancellation, idempotency, and credentials.
6. Run focused frontend/backend tests, full repository checks, and the browser acceptance flow.

## Acceptance criteria

- Cluster Run means “execute this cluster once like sequential manual Execute clicks.”
- A queued run ID never implies full historical replay.
- BacktestInit executes once and remains `ready`; it does not call `runAll()` in a cluster.
- An included OnBar advances exactly one candle/symbol step.
- Reachable downstream cluster members execute once from that single output; outside nodes never execute.
- Explicit full-workflow/backtest execution still supports `runAll()` unchanged.
- Outputs, credentials, pins, cancellation, idempotency, security boundaries, and saved-revision guarantees remain intact.
- No database migration is introduced.
