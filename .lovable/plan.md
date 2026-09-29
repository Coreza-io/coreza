# Make a cluster a visual folder with one-shot manual execution

## Goal

The cluster Execute control will run the nodes inside that folder exactly as if the user pressed each node’s normal **Execute** action in the correct dependency order.

```text
Individual node Execute  ─┐
                          ├─ shared normal-node action
Cluster Execute coordinator┘

Explicit workflow Run All ── existing full-workflow/backtest path (unchanged)
```

A cluster is not a separate execution product. It must not create a cluster-only workflow run, queue job, session type, result envelope, persistence contract, or database schema. Queues and historical replay remain available only to their existing non-cluster callers, including explicit full-workflow/backtest execution.

For `BacktestInit → OnBar → Compute`, one cluster click must initialize once, advance OnBar once through its normal editor action, then run Compute once from that fresh output. It must never call historical `runAll()` merely because the nodes are grouped.

## Confirmed implementation constraints

- Normal node behavior is currently concentrated in `useNodeExecution`, including validation, credentials, templates, selected input, support/tool-node payloads, pins, listeners, and result publication.
- `WorkflowExecutor.executeNode` currently reaches that behavior through a mounted node’s `auto-execute-node` listener. That mount-owned event bridge is not a reliable execution API for collapsed or otherwise unmounted nodes.
- `useNodeExecution.handleSubmit` catches failures internally, so a resolved promise does not currently prove success. A folder coordinator requires an explicit terminal outcome.
- Node field editing is component-local before its debounced graph update. Cluster execution must flush/read the latest draft, not a stale persisted value.
- The canonical nodes and edges remain unchanged when a cluster collapses; projection only changes what is displayed.
- The current cluster hook submits a saved-revision scoped run, polls it, hydrates results, and cancels it. That lifecycle is unnecessary for editor-style folder execution and is the source of behavior differing from individual Execute.
- Existing cluster validation already covers connected membership, main/attachment boundaries, triggers, Switch handles, and supported Loop boundaries. Scheduling must also account for expression references and runtime control behavior.

## Implementation plan

### 1. Define one shared normal-node action

Extract the executable work behind the current node Execute handler into an editor-owned service/action callable by `nodeId`. Keep the React hook and node button as thin adapters to this action.

The action must receive editor-owned accessors rather than component snapshots:

- canonical nodes and edges;
- latest node definition, values/field state, selected input source, and pinned output;
- execution store and output publisher;
- workflow/editor session identity and authenticated request client;
- abort signal and execution-generation guard;
- optional allowed-node scope for coordinated execution.

It must preserve all existing normal-node behavior:

- required-field and credential validation;
- field visibility and payload filtering;
- template and `$node[...]` reference resolution using current execution data;
- Edit Fields expressions and raw-value preservation;
- selected previous-node input and external input data;
- support/tool-node definitions and `__isTool` behavior;
- Compute, HTTP, BacktestInit, OnBar, Consolidator, Loop, Switch/control, and listener-specific actions;
- pinned outputs, including `false`, `0`, empty strings, and empty collections;
- the current standardized output/error shape and normal output-panel updates.

Return a typed outcome instead of relying on thrown-versus-resolved behavior:

```text
success | failed | cancelled | pinned | skipped | listener-started
```

Include the node ID, output when applicable, and structured error/reason. The individual Execute button, existing editor automation callers, and the cluster coordinator must all consume this same contract. Do not maintain a second cluster-specific node executor.

### 2. Remove execution ownership from mounted node UI

Replace the mounted `auto-execute-node` callback as the authoritative executor with the shared editor-owned action.

- `WorkflowExecutor.executeNode` and any remaining individual automation call the shared action directly by node ID.
- BaseNode continues to render state and invoke the action, but mounting is no longer required to execute.
- Collapsed cluster members may remain mounted for visual/runtime compatibility, but correctness cannot depend on that implementation detail.
- Remove callback polling of component output; action completion and output publication happen atomically through the shared contract.
- Preserve generation checks so late responses after workflow navigation or replacement cannot update the new editor.

### 3. Make current editor state authoritative

Before a node or cluster starts, synchronously commit pending field edits into the canonical node state or expose a current-draft registry keyed by node ID.

- Capture one execution snapshot of membership, topology, definitions, field settings, selected source mappings, and pins after pending edits are flushed.
- Use that snapshot for scheduling and validation, while reading newly produced execution outputs between node actions.
- Block settings, membership, edge, delete, and conflicting execution changes during a cluster run. Allow visual movement and expand/collapse because they do not alter the captured execution plan.
- Move Consolidator’s per-node series/source provenance out of a component-local ref into editor/session-owned runtime bookkeeping so collapsed execution and ordinary node execution use identical state.
- Clear that transient bookkeeping under the same reset/navigation rules as other editor execution state; do not persist it as cluster data.

### 4. Build a thin cluster coordinator

Replace `useClusterExecution`’s queued API lifecycle with an editor-side coordinator that accepts a cluster ID and calls the shared normal-node action serially.

At start, acquire a synchronous lock before any asynchronous save/validation work so a double click cannot launch two runs. Then:

1. Resolve the cluster’s canonical member IDs; never schedule synthetic compact-node IDs.
2. Flush current drafts and capture the execution snapshot.
3. Validate every member still exists and the cluster metadata/topology is valid.
4. Build a deterministic schedule from internal main-data dependencies plus supported expression/reference dependencies.
5. Identify external input/reference dependencies as read-only boundary values.
6. Classify attachments/tools and control nodes using existing edge semantics.
7. Preflight the complete schedule before the first side effect; reject unsupported cycles, ambiguous control flow, missing boundary data, or unsupported dependency shapes with a node-specific message.
8. Execute eligible members serially. Publish each completed output before resolving the next member’s input.
9. Stop on the first failure or cancellation, preserve completed outputs, and identify remaining members as not executed without fabricating output.
10. Release the lock on success, failure, cancellation, validation rejection, or navigation.

The coordinator must never execute or mutate an outside node. Outside nodes may only supply existing selected input, pinned data, or referenced output. Pass the allowed member-ID set into any normal action capable of internal downstream dispatch so Loop/control/listener behavior cannot escape the folder.

### 5. Preserve graph and control semantics

Do not implement a second generic workflow engine or treat the cluster as a flat array.

- Reuse/extract the existing dependency, branch, and edge-classification helpers where their behavior matches normal editor execution.
- A normal data node executes once after its required internal dependencies are available.
- A Switch/branch result schedules only the selected internal path; non-selected members receive `skipped`, not empty output.
- Attachment/tool nodes remain capabilities of their owning node and are not separately clicked by the coordinator unless the existing individual action explicitly dispatches them.
- Loop/control nodes keep their current normal editor semantics. Internally dispatched work must be scope-checked and must not be executed again by the outer schedule.
- Expression-only references affect ordering when the referenced node is inside the folder. An outside reference is boundary data and never causes outside execution.
- Reject a cycle or control configuration that cannot be represented safely by existing normal actions before executing anything.
- Listener/stream nodes use their existing `listener-started` completion contract. The coordinator must not wait indefinitely for future events or invent an event payload for downstream nodes. Event-driven continuation remains owned by the existing listener/control behavior and is constrained to the folder scope.

### 6. Guarantee BacktestInit and OnBar manual parity

Cluster execution calls the same endpoints/actions as the node buttons:

- BacktestInit performs its normal editor initialization once and returns `ready`.
- OnBar performs its normal single manual step once.
- A downstream member consumes that one fresh OnBar result.
- A BacktestInit-only folder initializes and stops.
- An OnBar-only folder may advance an existing valid editor session from boundary/current state once.

Do not send cluster Execute through `POST /workflows/:id/execute`, a workflow worker, or any path where a run ID can imply batch replay. Do not add `executionIntent`, a cluster execution mode, or a new server contract. The explicit Run All control and its current queue/backtest behavior remain unchanged.

### 7. Cancellation, concurrency, and stale-result safety

- Expose one active cluster run per editor and reject conflicts with individual Execute or Run All using the existing editor lock UX.
- Stop prevents the next member from starting and aborts the current request where that request supports cancellation.
- Cancellation does not roll back completed node outputs.
- Check the captured execution generation before and after every awaited action; ignore late responses after navigation/reset.
- A second cluster click while active is a no-op with clear feedback.
- Keep the run terminal outcome deterministic: completed, failed at a named node, or cancelled.

This is editor-local cancellation, not durable worker cancellation. No queue recovery or reload continuation is promised for a manual folder click, matching ordinary individual Execute behavior.

### 8. Update cluster controls and output behavior

Use the same coordinator state in both expanded and compact cluster controls:

- idle: Execute;
- running: current node and `completed / eligible` progress, plus Stop;
- failed: failed node and concise error, with Execute available for a fresh run;
- cancelled/completed: return to a stable executable state after showing the terminal result.

Every member writes through the normal execution store, so selecting it shows the same output as individual execution. Collapse/expand must not reset progress or outputs. Remove queued-only labels such as preparing, queued, polling, output hydration, and retry-output where they are no longer applicable.

### 9. Retire cluster-only queued plumbing safely

After switching all cluster controls and projections to the coordinator, perform a reference audit before deletion.

Remove only code that has no non-cluster caller:

- queued `useClusterExecution` submission/poll/recovery logic;
- cluster run-result hydration helpers and queued run-state types;
- retry-output UI and tests that exist solely for queued cluster results;
- frontend cluster calls to the scoped workflow execute/status/cancel APIs.

Do not remove shared workflow execution routes, queue services, run records, persistence, result utilities, or worker behavior used by Run All, backtests, live execution, history, or other features. No database migration is required. Existing saved cluster metadata remains unchanged.

## Verification plan

### Shared action tests

- Node button and direct shared action produce identical request payloads, outcomes, execution-store updates, errors, and outputs.
- Failures return `failed`; cancellation returns `cancelled`; pins return `pinned`; listener startup returns `listener-started`.
- Latest unsaved/debounced field values and selected credentials are used.
- Collapsed/unmounted execution succeeds without an `auto-execute-node` listener.
- Falsy pins and raw array/object outputs remain exact.
- Navigation generation prevents stale completion writes.

### Coordinator and graph tests

- A linear folder executes once in stable dependency order and feeds each fresh output to the next node.
- Internal expression references add ordering dependencies; external references/input are read without executing their source.
- No outside member executes, including through downstream dispatch.
- Branch selection executes only the chosen path and marks the other path skipped.
- Attachment/tool nodes are not double-executed.
- Supported Loop/control behavior remains equivalent to sequential normal actions and stays in scope.
- Unsupported cycles/control shapes fail preflight before side effects.
- Failure preserves completed outputs and starts no later member.
- Double click starts one run; Stop prevents the next action; navigation ignores a late response.
- Collapse/expand during execution does not interrupt or duplicate execution.
- Listener startup terminates the synchronous coordinator correctly without waiting for an event.

### Backtest and data-chain tests

- `BacktestInit → OnBar` initializes once and advances exactly one bar/symbol step; `runAll()` is never called.
- `BacktestInit → OnBar → Compute` gives Compute the fresh one-step OnBar output.
- `OnBar → Consolidator → Compute` passes the fresh output through the shared per-node Consolidator state.
- Repeating a cluster click matches repeating the corresponding individual Execute sequence.
- Explicit full-workflow/backtest Run All still processes the historical range unchanged.
- Grouped and ungrouped nodes behave identically under full-workflow execution.

### Browser acceptance

1. Create linear, branched, attachment, loop, listener, pinned, external-input, and expression-reference examples.
2. Run the same nodes individually and through a folder; compare order, requests, outputs, errors, and backtest cursor movement.
3. Repeat while the folder is expanded and collapsed.
4. Edit a field and immediately click folder Execute; verify the latest value is used.
5. Verify current-node progress, failure attribution, Stop, double-click protection, navigation safety, and output-panel selection.
6. Run explicit Run All separately and confirm its existing queued/batch behavior is unchanged.
7. Run focused frontend/backend tests, repository checks, and desktop/mobile control-layout checks.

## Delivery order

1. Add failing parity tests around the normal node action, collapsed execution, and typed outcomes.
2. Extract the shared editor-owned action and migrate the individual Execute path without changing behavior.
3. Add draft flushing and editor/session-owned Consolidator bookkeeping.
4. Implement dependency/control preflight and the serial cluster coordinator.
5. Wire expanded/compact controls, progress, Stop, and normal output publication.
6. Add BacktestInit/OnBar and complex graph parity tests.
7. Audit callers, remove unused cluster-only queue/hydration code, and verify Run All remains unchanged.
8. Complete browser acceptance and full regression checks.

## Acceptance criteria

- Cluster Execute is equivalent to pressing each eligible member’s normal Execute action once in valid dependency/control order.
- BacktestInit initializes once; OnBar advances once; only explicit Run All performs batch replay.
- The implementation works while expanded or collapsed and does not rely on mounted node callbacks.
- Fresh settings, credentials, inputs, references, pins, branches, loops, attachments, listeners, and outputs retain normal-node semantics.
- Nodes outside the folder never execute or mutate.
- Failure and Stop preserve completed outputs and prevent later actions.
- Individual Execute and Run All retain their existing behavior.
- Cluster execution adds no queue, worker, session, API, output, or database contract.
