# Complete manual cluster execution and fix invisible cluster members

## Objective

Deliver clusters as presentation-only visual folders whose Execute control runs the same normal node actions as individual Execute, once, in dependency/control order. At the same time, prevent collapsed display decorations from entering canonical workflow state and repair any affected in-memory nodes so expansion and Dissolve always restore visible, interactive nodes.

```text
Canonical workflow document
  ├─ transient expanded/collapsed display projection
  ├─ individual Execute ─┐
  └─ cluster coordinator ┴─ shared editor-owned normal-node action

Explicit Run All → existing full-workflow/backtest execution (unchanged)
```

No cluster-specific queue, worker session, database schema, saved result contract, or output format will be added. Existing queue infrastructure remains for full workflows, explicit backtests, live execution, history, and other existing callers.

## Verified current state

- Collapsed projection copies canonical members and adds `cluster-runtime-host`, hidden styles, `aria-hidden`, and disabled interaction flags.
- React Flow receives those projected copies, while `onNodesChange` currently accepts every change whose ID is canonical. A `replace` change can therefore copy a decorated display object into canonical node state.
- Node output and field-state writers call React Flow `setNodes`; every writer must be routed to canonical patch operations so projected objects cannot become document sources.
- Expansion returns canonical nodes unchanged, and Dissolve only removes cluster metadata. Therefore leaked display attributes survive both actions.
- Workflow serialization uses an explicit allowlist and excludes the display attributes, so persistent database corruption is not established. Current editor state and undo/redo snapshots can still be contaminated.
- Existing projection unit tests prove pure projection does not mutate its input. The runtime-host test does not render real React Flow styling and cannot detect the reported invisible-node failure.
- This checkout still uses queued cluster execution and mounted `auto-execute-node` listeners. The editor-owned action service and serial coordinator reviewed in PR #768 are not present here, so they are implementation prerequisites rather than completed work.

## Implementation plan

### 1. Add a regression test for the exact visibility failure

Before changing behavior, reproduce the complete state transition in a real React Flow integration/browser test:

1. Render an expanded cluster with visible, interactive member bodies.
2. Collapse it and verify the compact folder is visible while members are hidden.
3. Publish a node output, edit a field, and exercise a representative pin/listener update while collapsed.
4. Expand it and assert every member body is visible, interactive, focusable as expected, and located correctly.
5. Repeat collapse/update, then Dissolve; assert original member nodes and canonical edges remain visible and usable.
6. Exercise undo and redo around grouping/collapse/Dissolve and assert no hidden presentation flags reappear.

Inspect computed `visibility`, `pointer-events`, accessible state, controls, and interaction—not only DOM presence or member count. Keep the existing projection/runtime-host tests, but do not treat them as sufficient coverage.

### 2. Establish strict canonical-versus-display ownership

Treat the canonical graph as the only editable workflow document and projection results as immutable render data.

Add editor-owned canonical operations with narrow responsibilities, such as:

- `updateNodeData(nodeId, patch)` for values, field state, output, pins, listener state, and execution flags;
- `updateNodePosition(nodeId, position)` for drag operations;
- explicit add/remove/document-replace commands for structural edits;
- canonical edge mutations through the existing document command/validation path.

All operations must start from the current canonical object by ID. They must never spread a node object received from React Flow’s projected display array.

Route every node writer through these operations, including:

- successful and failed execution output;
- pinned-output save/unpin;
- single and batch field changes plus schema reconciliation;
- listener/streaming state and output updates;
- execution highlighting/status;
- node rename and any other mounted-node update path.

Keep canonical publication in the stable graph store, but make writes explicit rather than exposing projected React Flow objects as writable document state.

### 3. Restrict React Flow change ingestion

Replace the current “canonical ID means safe” filter in `onNodesChange` with an allowlisted adapter:

- translate supported selection changes into a canonical `selected` patch;
- translate position/drag changes into canonical coordinates;
- accept measured dimensions only if the editor intentionally stores them, and copy only those fields;
- preserve the existing synthetic compact-folder drag translation into member positions;
- reject display-originated `replace` and `add` changes from the generic canvas callback;
- process removals only through canonical delete commands so cluster validation, listener cleanup, history, and edges remain consistent;
- where a replacement is genuinely required, reconstruct it from the existing canonical node plus explicitly allowed fields.

Never copy `className`, display `style`, `domAttributes`, `draggable`, `selectable`, `connectable`, `deletable`, `focusable`, synthetic callback data, or compact display IDs from projection into the document.

### 4. Repair already contaminated in-memory state and history

Create a narrow normalizer for nodes positively identified by the reserved `cluster-runtime-host` marker.

It must:

- remove all duplicate occurrences of that reserved class token;
- remove only the projection-owned style keys and the projection-owned `aria-hidden` value;
- restore interaction flags from a clean canonical baseline when one exists;
- otherwise restore documented node-type defaults only for positively identified contaminated nodes;
- preserve IDs, positions, values, field state, pins, outputs, definitions, edges, legitimate custom classes/styles, and intentional hidden-node behavior.

Apply normalization at trusted ingress/restoration boundaries:

- initial workflow load/import after canonical deserialization;
- current editor state once during upgrade/repair;
- undo/redo document restoration;
- clipboard/template restoration if those paths can carry full node objects.

Expansion and Dissolve should not need special visibility mutations after canonical state is clean; they only change view or membership state. Saving/reloading must remain safe, but must not be the required repair mechanism.

### 5. Keep projection transient by construction

Retain projection as a pure derivation from canonical nodes, edges, cluster metadata, and view state.

- Generate hidden runtime-host attributes only in projected copies.
- Keep synthetic compact IDs and callbacks confined to display data.
- Add development/test invariants asserting that canonical snapshots and history contain neither the reserved display ID prefix nor projection-owned flags.
- Freeze or otherwise guard projected inputs in tests to expose accidental mutation.
- Keep hidden runtime hosts temporarily because execution/listener ownership still depends on mounted node components in this checkout.
- Only after the shared executor is independent of component mounting, assess removing hidden runtime hosts as a separate cleanup; do not make that optional cleanup part of this fix’s critical path.

### 6. Extract a real editor-owned normal-node action

Move the executable logic behind `useNodeExecution.handleSubmit` into a non-React editor service/action callable by node ID. Hooks and buttons become adapters; they do not register the implementation.

The action receives editor-owned accessors and an immutable run snapshot:

- canonical nodes, edges, definitions, and latest node settings;
- selected input-source mapping and current execution data;
- workflow/editor session identity and authenticated request client;
- output publisher/canonical patch operation;
- execution-generation guard and abort signal;
- allowed node IDs for bounded internal dispatch.

Preserve normal individual behavior for validation, credential selection, field visibility, template/reference resolution, Edit Fields, support/tool nodes, pins, Compute/HTTP/backtest/Consolidator/control actions, listeners, and standardized outputs.

Return an explicit typed result rather than swallowing errors:

```text
success | failed | cancelled | pinned | skipped | listener-started
```

The result includes node ID, output when present, and structured reason/error. Individual Execute, existing workflow helpers, and cluster coordination all call this one action. Remove mounted callback registration and output polling only after every caller has migrated.

### 7. Capture one authoritative draft and runtime snapshot

Provide synchronous draft publication or an editor-owned draft registry so immediate execution cannot race the 50 ms field synchronization.

At cluster start:

1. acquire the execution lock synchronously;
2. flush the latest values, selected source, credential, and expression edits;
3. capture canonical membership, topology, definitions, settings, pins, and external reference/input snapshots;
4. validate and compile the schedule from that same snapshot;
5. read newly produced member outputs between node actions.

Changing an expression dependency and immediately pressing Execute must use the new expression and matching schedule.

Move Consolidator’s per-node series signature/provenance out of a component-local ref into editor/workflow-session runtime storage so individual and collapsed cluster execution share the same state. Clear it using the existing editor reset/navigation lifecycle; do not persist it as cluster metadata.

### 8. Build the thin editor-side cluster coordinator

Replace the queued cluster submission/polling path with a coordinator over the shared normal-node action.

#### Preflight

- Resolve only canonical member IDs; reject synthetic display IDs.
- Revalidate current cluster metadata and every member’s existence.
- Classify main versus attachment/tool edges with the existing edge-semantics helper.
- Build a deterministic schedule from internal main dependencies and statically discoverable expression references.
- Snapshot outside inputs/references without executing or mutating their source nodes.
- Reject missing required boundary data, unsupported cycles, unsupported control shapes, malformed triggers, and any dispatch path that cannot be safely bounded before the first side effect.
- Keep exact falsy pins and classify attachments/tools without independently executing them.

#### Run

- Execute eligible members serially in dependency/control order.
- Publish each completed result through the normal execution store and canonical output patch before resolving the next member’s input.
- Stop on the first failure, preserve completed outputs, and mark remaining eligible members as not executed/dependency blocked without inventing output.
- Release the lock on every terminal path.

Do not route cluster Execute through `POST /workflows/:id/execute`. Do not require save-before-run solely for a manual folder click. Keep the queued route and backend compiler only for their remaining non-folder callers.

### 9. Enforce member scope at every dispatch boundary

Passing `allowedNodeIds` is insufficient unless every shared action and control dispatcher consumes it.

- Thread the immutable member set through the shared action, Loop/branch continuation, attachment/tool invocation, listener continuation, and any downstream dispatch helper.
- Check a target against the scope before scheduling, mutating its execution store data, or invoking its action.
- Outside nodes may supply frozen boundary data, pins, or reference values only.
- Reject unsupported escape paths during preflight when possible; retain runtime guards as defense in depth.
- Add assertions that outside node outputs, inputs, flags, and listener state remain byte-for-byte unchanged.

### 10. Reuse established control-result decoding

Remove any cluster-only `branchHandle` interpretation. Use the same decoder and edge semantics as normal workflow execution.

- Decode actual standardized If/Switch envelopes, including nested `data.result`, without blindly unwrapping arbitrary business objects.
- Match dynamic Switch handles using existing definitions.
- Execute only the selected internal branch and mark the unselected path skipped.
- Preserve reconvergent branch dependency rules.
- Keep attachment edges out of main scheduling.
- Reuse existing Loop semantics within the member boundary; never replace them with a naive topological list or independently execute internally dispatched nodes twice.
- If an existing control shape cannot safely run as sequential normal editor actions, reject it before side effects with a node-specific explanation.

### 11. Preserve BacktestInit, OnBar, Consolidator, and listener parity

For `BacktestInit → OnBar → Consolidator → Compute`:

- BacktestInit invokes the normal editor initialization once and returns `ready`.
- OnBar invokes the normal editor action once and advances one bar/symbol step.
- Consolidator receives that fresh OnBar result and uses editor-session, node-scoped continuation state.
- Compute receives the fresh Consolidator output.
- Historical `runAll()` is never triggered by folder membership.

A subsequent individual OnBar action must advance the same valid editor session to the next step. Only explicit Run All preserves full historical/batch behavior.

Listeners and streams retain their normal start/listening contract. A `listener-started` result completes the synchronous action; the coordinator must not wait indefinitely or fabricate future event data. Later event-driven dispatch remains subject to the captured member boundary.

### 12. Unify execution locking, cancellation, and stale-response protection

Use one editor-level execution coordinator for individual Execute, cluster Execute, and Run All conflict checks.

- Prevent double-click cluster starts with a synchronous lock.
- Block another node, cluster, Run All, membership edit, structural edge edit, delete, or Dissolve while a cluster action is active.
- Permit expand/collapse and visual movement because they do not alter the captured execution plan.
- Stop prevents the next node from starting and passes an AbortSignal to the current request where supported.
- Completed outputs are not rolled back.
- Check the existing editor execution generation before and after every awaited action; late results after navigation/reset cannot update the current graph.
- Make terminal state deterministic: completed, failed at a named node, or cancelled.

This is editor-local cancellation, matching individual manual execution. It does not promise durable recovery after reload.

### 13. Update expanded and compact cluster controls

Both controls consume one coordinator state:

- idle: Execute;
- running: current member and `completed / eligible` progress, plus Stop;
- failed: failed node and concise reason, then allow a fresh run;
- cancelled/completed: stable terminal feedback followed by a reusable Execute state;
- blocked: explain the conflicting execution or invalid topology.

Member outputs appear through their normal output panels. Collapse/expand cannot reset execution or outputs. Remove queued-only states and controls such as queued polling, result hydration retries, and server cancellation from the folder UI.

### 14. Retire cluster-only queued code after a caller audit

Once all folder controls use the coordinator, remove only code proven to have no other caller:

- cluster-only queued submit/status/cancel and polling logic;
- cluster run-result hydration helpers and their tests;
- retry-output UI and queued run identity fields;
- frontend cluster calls to scoped workflow execution APIs.

Do not remove shared workflow routes, backend planning, queue services, workflow-run records, persistence, history, or result utilities used by Run All, backtests, live execution, or other features. No database migration is required.

## Test plan

### Canonical/display isolation

- Collapse → output success/error update → expand: members are visible and interactive.
- Collapse → field, pin, listener, and streaming update → expand/Dissolve: no projected class, style, ARIA, or interaction flag enters canonical state.
- React Flow `replace` using a projected member cannot replace canonical data.
- Synthetic compact-node add/replace/remove cannot enter canonical document commands.
- Undo/redo after contamination-prone sequences remains visible and structurally correct.
- Targeted cleanup removes duplicate reserved markers while preserving legitimate custom styling and intentionally hidden nodes.
- Save/reload grouped and dissolved workflows preserves IDs, values, pins, positions, edges, and visibility.

### Shared normal action

- Node button and direct shared action produce identical payloads, validation, credentials, outputs, errors, and execution-store writes.
- A never-mounted and an unmounted node execute from current canonical settings.
- Immediate scalar, credential, and expression edits are present in the action snapshot.
- Typed outcomes distinguish failure, cancellation, pin, skip, and listener startup.
- Falsy pins and raw array/object outputs are preserved exactly.
- Abort and generation fencing prevent stale completion writes.

### Coordinator and scope

- Linear and independent members execute once in stable order.
- Internal expression dependencies affect order; external input/reference values are snapshotted without outside execution.
- If/Switch tests use real normalized envelopes, dynamic handles, and reconvergent branches.
- Attachment/tool nodes are available to owners but not double-executed.
- Supported Loop behavior matches normal actions and remains in scope; unsupported cycles/control shapes fail before side effects.
- Internal dispatch toward an outside node is rejected and leaves that node untouched.
- First failure preserves completed outputs and prevents later members.
- Double click starts once; Stop prevents the next action; navigation drops late results.
- Execution works identically expanded, collapsed, and after a collapse toggle during a run.

### Domain-specific parity

- `BacktestInit → OnBar` returns ready plus exactly the first manual step and never invokes historical replay.
- Running individual OnBar afterward returns the next step from the same editor session.
- `OnBar → Consolidator → Compute` passes fresh output end to end and preserves per-node Consolidator continuation state.
- Listener startup completes without waiting for a future event or leaking execution outside membership.
- Grouped and ungrouped full-workflow Run All behavior remains identical.

### Browser acceptance

1. Verify collapse/update/expand and collapse/update/Dissolve with computed visibility, pointer events, accessible controls, positions, and edges.
2. Repeat after undo/redo and save/reload.
3. Run the same workflow nodes individually and through expanded/collapsed folders; compare requests, order, outputs, errors, and backtest cursor movement.
4. Edit an expression and credential, then execute immediately; verify the latest values and dependency order.
5. Exercise If, Switch, Loop, attachment/tool, listener, external-input, pin, failure, Stop, double-click, and navigation cases.
6. Run explicit Run All separately and confirm its existing queued/batch behavior is unchanged.
7. Run focused unit/integration suites, repository checks, and responsive control-layout checks.

## Delivery sequence

1. Add the real React Flow collapse/update/expand/Dissolve regression.
2. Add canonical patch operations and restrict React Flow change ingestion.
3. Add targeted contaminated-state/history repair and canonical invariants.
4. Audit and migrate all node writers to canonical operations.
5. Extract the editor-owned normal-node action with typed outcomes, scope, abort, and generation support.
6. Add authoritative draft capture and shared Consolidator runtime bookkeeping.
7. Implement preflight, control-aware ordering, and the serial folder coordinator.
8. Wire expanded/compact controls, progress, Stop, and normal output publication.
9. Add full parity, boundary, control, backtest, and visibility tests.
10. Audit callers, retire unused cluster-only queued frontend code, and run full regression/browser acceptance.

## Acceptance criteria

- Expanding or dissolving a cluster always restores every member visibly and interactively, including after updates while collapsed and undo/redo.
- Canonical nodes and history never contain projection-owned attributes or synthetic IDs.
- Cluster Execute runs the same editor-owned normal action as individual Execute and does not depend on mounted callbacks.
- Latest drafts, credentials, inputs, references, pins, branches, loops, attachments, listeners, and outputs preserve individual-node semantics.
- Allowed member scope is enforced at every internal dispatch; outside nodes never execute or mutate.
- BacktestInit initializes once, OnBar advances once, and only explicit Run All performs historical batch execution.
- Stop/failure preserve completed results and prevent further member actions; stale responses cannot affect another workflow session.
- Full-workflow execution and persistence remain unchanged, with no new database or cluster runtime contract.
