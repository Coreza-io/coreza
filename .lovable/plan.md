# Generic bottom-center Execute controls for nodes and clusters

## Goal

Add one icon-only Execute control at the bottom center of every editable node card that supports the existing manual action, and use the same visual control for compact and expanded clusters.

- The control stays visible in collapsed and expanded cards without hover or selection.
- Node Execute runs only that node through its existing normal editor action.
- Cluster Execute keeps its existing editor-local sequence of normal member actions.
- Explicit Run All remains the only batch/full-workflow command.
- Execution never expands a collapsed card. No new backend route, database change, workflow field, or cluster execution mode is required.

## Validated current state

- `ClusterExecutionControl` is a cluster-specific text button. Compact clusters place it in a left-aligned footer; expanded cluster frames use a 52px footer without horizontal centering.
- Normal nodes render text submit buttons only inside expanded Basic and Repeater forms. `NodeWrapper`, which owns collapsed and expanded shells, has no action slot.
- `NodeRouter` covers manifest nodes. `LoopNode` is the only separate BaseNode/NodeWrapper renderer and currently omits workflow/read-only propagation.
- Every mounted `BaseNode` already owns one normal `handleSubmit`, `isSending`, error state, listener state, and stop handlers. The new control must reuse that action instead of registering another action or mounting another form.
- A missing manifest `action` does not mean non-executable: ChatInput, InMemory, and Loop intentionally execute locally. Visualize is the established visible exception, and `node_type: sub` attachments are not independently scheduled. There is no current declarative capability flag, so eligibility needs one authoritative policy instead of category, `node_type`, `definition.action`, or mounted callback availability.
- The collapsed shell already uses bottom center for a read-only item-count badge and bottom right for the tool-mode toggle. The new band must deliberately relocate/partition those elements rather than merely overlaying them.
- Cluster execution owns a synchronous session lock, but its lock map is not reactive. Individual execution and Run All do not acquire that shared lock themselves, so truthful globally blocked/running controls require one subscribed coordinator.
- Collapsed cluster members remain mounted as invisible runtime hosts with `aria-hidden`, disabled focus, hidden visibility, and no pointer interaction. Their controls must remain equally hidden and unfocusable.

## Implementation plan

### 1. Add behavior-first regression tests

Before moving UI, cover:

- Play, Stop, spinner, failed, and blocked presentations without visible execution text;
- pointer, double-click, Enter, and Space activating once without expanding, dragging, panning, double-submitting, or triggering canvas shortcuts;
- node and cluster adapters invoking their existing commands exactly once;
- collapsed and expanded node execution producing identical validation, request, pin, listener, output, and error behavior;
- compact and expanded cluster controls preserving coordinator progress, cancellation, retry, and reason state;
- read-only views, projected hidden members, attachment-only nodes, and Visualize exposing no actionable or focusable control;
- lock conflicts among individual Execute, cluster Execute, and Run All, even when rendered disabled state is stale.

Prefer behavioral assertions and measured geometry over Tailwind-class snapshots.

### 2. Define independent execution eligibility

Add an explicit declarative manual-execution capability to the normalized node definition/registry, expose it through a small pure resolver, and use that resolver for node-button visibility and cluster planning. Do not derive eligibility from whether a React callback happens to be registered: that would preserve the mount-timing race the wider execution architecture is meant to remove.

- Allow normal backend actions and intentional local actions such as ChatInput, InMemory, and Loop.
- Allow BacktestInit and OnBar with their existing initialize-once and one-step behavior.
- Allow trigger/listener nodes where the established action can start listening.
- Exclude `node_type: sub` attachments from independent execution.
- Mark Visualize unavailable and omit its control, preserving its current intentional exception unless its manual-action contract is deliberately changed later.
- Return a typed unavailable reason, while the requested UI hides unsupported controls instead of showing decorative disabled buttons.
- Never infer capability from category, `node_type`, `definition.action`, or current component mount state.

Audit every manifest definition and Loop against the resolver. Add a manifest-wide test so a new renderer or capability cannot silently miss the shared control.

### 3. Build one presentational icon control

Create `ExecutionIconButton` using the existing Button and Tooltip components. Its model contains target kind/name, phase, disabled reason, optional status description, Execute callback, and an optional real Stop callback.

- Use Play for idle/completed/cancelled, and Play with error styling for failed.
- Show Stop only when cancellation/listener-stop is real; otherwise show a disabled spinner while running/stopping.
- Keep blocked controls focusable with `aria-disabled` when their reason must be explained, with an authoritative activation guard.
- Keep a fixed 36×36 footprint and 16px glyph across all states.
- Provide dynamic `aria-label`, `aria-busy`, decorative icons, focusable Tooltip content, and restrained status announcements.
- Use `type="button"`, `nodrag`, `nopan`, and pointer/click/double-click/key propagation isolation while preserving native focus and one native activation.

The component must not fetch, traverse graphs, mutate React Flow, or infer capabilities.

### 4. Adapt the existing node action once

Have `BaseNode` derive a control model from its existing `handleSubmit`, `isSending`, validation error, listener state/stop handler, workflow session, and read-only state. Expose it through render props; never invoke the execution hook twice. Preserve the cluster control's existing polite live region in the generic component, but throttle progress announcements so screen readers do not announce every member tick.

- Play calls the same `handleSubmit` command as form submission and retains its typed outcome.
- Preserve validation, credentials, selected/upstream inputs, expressions, pins including falsy values, references, Consolidator context, outputs, and errors.
- A collapsed failure stays collapsed and reports through the established status/toast/error surface; do not silently open settings or outputs.
- Successful collapsed execution publishes output and keeps the card collapsed.
- Listener nodes map the existing start result and real stop handler without duplicate subscriptions.
- Do not advertise Stop for ordinary requests until the underlying action accepts and honors coordinator cancellation.

### 5. Add one action slot to `NodeWrapper`

Add `executionControl?: ReactNode` and render it once, outside the conditional expanded form body, in a bottom-centered action band shared by both card states.

- Render only for editable, visible, independently executable nodes.
- Reserve space so icons, titles, fields, errors, and the control cannot overlap. Keep the read-only item-count badge in its current bottom-center position only when the action control is absent; partition or relocate the editor tool toggle so it cannot collide with the new center band.
- Preserve the default 200×150 collapsed card and explicitly audit AIAgent's 320×150 horizontal card, currently the only custom `collapsedSize`; increase a documented minimum only if measured content cannot fit.
- Keep clear of bottom handles, especially AIAgent attachment handles, and verify connections remain usable.
- In expanded cards, add bottom space instead of covering the last field.
- Update React Flow internals through the existing measurement lifecycle when bounds change.
- Preserve body drag, selection, rename, delete, tool mode, panels, and explicit collapse controls.

Pass the slot through `NodeRouter`. Wire `LoopNode` identically. Separately fix its existing omission of workflow identity and read-only propagation, then prove its current manual one-step action works before and after moving the control; read-only Loop cards must no longer expose the accidentally enabled form action.

### 6. Remove duplicate visible submit controls safely

- Remove visible Execute buttons from Basic and Repeater layouts after the wrapper control works.
- Keep `<form onSubmit={handleSubmit}>` so Enter in fields still reaches the same command.
- Keep the outer icon `type="button"` so it cannot submit a form as a side effect.
- Retain inline form errors and authentication dialogs.
- Replace the Repeater layout's Visualize special case with the shared capability policy.
- Audit native required constraints because collapsed execution cannot depend on expanded controls; application validation remains authoritative.

Exactly one visible execution control may exist per eligible node in either state.

### 7. Reuse the shared control for clusters

Keep `ClusterExecutionControl` as a thin adapter from `ClusterRunState` to the generic component.

- Map idle/completed/cancelled/failed/blocked/running accurately.
- Preserve `executeCluster(clusterId)` and `cancelRun(clusterId)`; do not create another execution path.
- Move current progress/member/reason text into Tooltip and accessible status. Remove visible Execute, progress, and Run again text.
- Keep real Stop behavior during a cancellable cluster run and block duplicate runs.

Compact cluster:

- retain 280×180 size, title, note, member count, handles, and expand control;
- use a fixed full-width bottom band and center the 36×36 control;
- constrain content above it so long text cannot overlap.

Expanded cluster:

- center the control in the existing 52px full-frame footer;
- keep member bounds above it and center relative to the whole frame;
- preserve the overlay pointer model so only existing header actions and the footer control intercept interaction.

### 8. Make execution state truthful and reactive

Extend the existing editor execution service into a subscribed session-scoped coordinator, not a parallel UI lock. Expose active target kind/id, phase, cancellation capability, and blocked reason through `useSyncExternalStore` with narrow selectors.

- Individual Execute, cluster Execute, and Run All acquire the same lock synchronously before awaits and release in `finally`.
- Cluster member calls inherit the owner token and do not reacquire.
- The active target displays running/listening/Stop as supported; other controls show blocked while occupied.
- Command guards remain authoritative even if rendering is stale.
- Suppress rapid double activation, including pinned or synchronous local actions, without delaying normal single clicks.
- Reset/navigation clears state and generation-fences stale completion, listener, error, and output writes.
- Preserve completed output on Stop/failure; Stop prevents later cluster members or Run All steps.

This closes an existing correctness gap needed by shared controls without changing execution semantics.

### 9. Preserve canonical/projection boundaries

- Keep execution state in the editor/runtime service; never persist callbacks, button state, DOM attributes, or placement in workflow nodes.
- Resolve and publish by canonical node ID only.
- Never mutate compact-cluster projection nodes or hidden runtime-host copies.
- Keep hidden member hosts `aria-hidden`, unfocusable, pointer-disabled, and invisible.
- Expand, collapse, Dissolve, undo/redo, save/reload, and output updates must not duplicate controls, expose hidden controls, or copy display-only fields into canonical/history state.

### 10. Verification

Component tests:

1. Icon/state mapping, Tooltip, accessible label, `aria-busy`, focus retention, and fixed dimensions.
2. Mouse, double-click, Enter, and Space invoke once; blocked/busy states never invoke.
3. Supported Stop invokes cancellation; unsupported running state is spinner-only.
4. No visible execution text remains in shared node/cluster controls.

Integration tests:

1. Every eligible manifest renderer plus Loop receives exactly one control; exclusions receive none.
2. Form submit and collapsed/expanded icon paths reach the same node command and outcome.
3. Required fields and credentials fail visibly while collapsed without expanding.
4. Pins preserve `false`, `0`, empty string, arrays, and objects exactly.
5. Individual Execute does not traverse neighbors; cluster Execute keeps member scope/order; Run All remains the only batch command.
6. BacktestInit executes once, OnBar advances once, and no node/cluster icon starts historical replay.
7. Listener start/stop never duplicates subscriptions.
8. Individual/cluster/Run All conflicts update controls and prevent duplicate work.
9. Reset/navigation/collapse cannot publish stale outcomes.

Browser acceptance:

1. Compare a Store node and compact cluster first; measure bottom-center alignment within a small tolerance.
2. Check collapsed/expanded normal nodes, Loop, listener, BacktestInit, OnBar, AIAgent with bottom handles, Visualize, an attachment, and read-only history.
3. Exercise long titles/notes, expanded forms, light/dark themes, and normal/extreme canvas zoom for clipping; do not promise constant screen-size controls under zoom.
4. Confirm clicks never drag, pan, select, expand, rename, double-submit, or start a connection; bottom handles remain connectable.
5. Run collapsed, expand, and inspect the same result without another request; verify equivalent expanded execution.
6. Run compact and expanded clusters and verify unchanged order, output, progress, Stop, retry, and card state.
7. Collapse cluster, update output/error/status, expand and Dissolve; member controls reappear once and work.
8. Repeat across undo/redo and save/reload; hidden members and read-only views stay non-actionable.
9. Place an expanded cluster near the viewport bottom and verify its centered cluster control remains visually distinct from and does not overlap the fixed page-level Run All control.

Run focused Vitest suites, TypeScript checks, node-definition validation, preview diagnostics, and Playwright. Record actual commands, outcomes, and screenshots; prior healthy output is not new evidence.

## Delivery order

1. Add capability and shared-control tests.
2. Build the generic control and cluster adapter.
3. Center compact and expanded cluster controls.
4. Add the BaseNode model and NodeWrapper slot; wire NodeRouter and Loop.
5. Remove duplicate form buttons and verify collapsed/expanded parity.
6. Add reactive coordination and unify individual/cluster/Run All lock ownership.
7. Complete manifest-wide, interaction, geometry, projection, and browser acceptance.

## Acceptance criteria

- Every editable independently executable node runs once while collapsed or expanded through one bottom-centered icon control.
- Compact and expanded clusters use the same visual control with unchanged local member execution and cancellation.
- No visible execution labels remain beside controls.
- Unsupported, hidden, and read-only nodes are not actionable or focusable.
- Execution, locking, output fidelity, accessibility, connections, card state, projection restoration, and Run All separation pass the tests above.