# Node execution controls: hover Play when collapsed, full Execute when expanded

## Goal

Give every manually executable editor node two presentations backed by one execution command:

| Node state | Control |
| --- | --- |
| Collapsed, idle pointer | Bottom-center Play control hidden |
| Collapsed, hovered or keyboard-focused | Bottom-center Play control visible |
| Expanded | Full-width Execute control at the end of the form |
| Read-only or independently non-executable | No control |

The collapsed control must not require selection. Running a node must not expand or collapse it. Cluster controls and cluster execution behavior remain unchanged.

## Verified checkout state

- This checkout is older than the implementation assumed by the attachment: there is no `ExecutionIconButton`, no `resolveManualExecution`, no execution slot in `NodeWrapper`, and no node-control forwarding through `NodeRouter` or `LoopNode`.
- Basic and Repeater layouts still contain their original text submit buttons. Repeater intentionally omits Execute for Visualize.
- `BaseNode` already creates the single normal execution hook and exposes `handleSubmit`, `isSending`, error, listener state, and listener stop behavior. Both presentations must reuse these values; a second execution hook or API path is unnecessary.
- `NodeWrapper` owns the collapsed/expanded state, so it is the correct owner of collapsed-only hover/focus visibility. Its card already has nested unnamed `group` classes, making a named hover group necessary.
- Individual execution now acquires the session lock in `executeEditorNode`; Run All and direct editor node execution also pass through shared lock ownership. The lock map is not reactive, so another active target is enforced at command time but is not yet reflected immediately in every visible control.
- `LoopNode` currently omits explicit workflow ID and read-only propagation. That can expose its form action in history/read-only rendering and must be corrected while wiring the controls.
- The default collapsed card is 200×150. AIAgent is the only current custom collapsed size at 320×150 and has bottom attachment handles. The bottom action must not overlap those handles or the existing bottom-right tool toggle.
- No backend, database, saved workflow, cluster algorithm, or execution-output change is needed.

## Implementation plan

### 1. Add focused behavior tests first

Create failing component/integration tests for:

- collapsed control absent from view before hover, visible on card hover, and independent of selection;
- keyboard Tab focusing the collapsed control reveals it and Enter/Space activate exactly once;
- expanded view showing one full-width Execute control and no bottom icon duplicate;
- collapse/expand switching presentation without changing fields, output, listener state, or execution state;
- read-only and unsupported nodes rendering neither presentation;
- Basic, Repeater, and Loop nodes sharing the same command and state;
- clicks/double-clicks not expanding, dragging, panning, renaming, deleting, connecting, or executing twice;
- overlapping node, cluster, and Run All commands being rejected by the existing session lock.

Use request counts and output assertions for execution parity; visual assertions alone are insufficient.

### 2. Define the existing manual-execution availability policy

Add a pure `resolveManualExecution(definition)` helper that preserves the established editor contract:

- ordinary main, trigger/listener, backtest, and intentional local-action nodes are available;
- Loop is available and keeps its current one-manual-step behavior;
- `node_type: sub` attachments are not independently executable;
- Visualize remains unavailable, matching its current missing expanded Execute action;
- an unknown or malformed definition is unavailable with a typed reason.

Use this resolver in both presentations and test it against the full manifest. Do not infer availability only from `definition.action`: ChatInput, InMemory, and Loop intentionally execute without a backend action. Do not add a persisted workflow property merely for presentation gating.

### 3. Create one shared execution-control component

Add a reusable node execution control with `presentation: "icon" | "labelled"` and one activation path.

Shared inputs:

- target name;
- state: idle, running, listening, failed, or blocked;
- status/blocked reason;
- Execute callback;
- optional real listener Stop callback.

Icon presentation:

- preserve the existing small Play/Spinner/Stop visual language and fixed footprint;
- use a Tooltip and an action-specific accessible label;
- keep failed/retry and blocked reasons in the Tooltip/status surface.

Labelled presentation:

- reuse the existing full-width `nodeExecute` Button variant;
- show Execute, Executing…, or Stop as appropriate;
- do not apply icon-only width/height classes.

Both presentations must use the same guarded activation function, `type="button"`, `nodrag`, `nopan`, fixed busy behavior, and pointer/click/double-click/key propagation isolation. Preserve native focus and one Enter/Space activation. Keep ordinary in-flight actions spinner-only; only show Stop where the existing listener stop handler is real.

### 4. Build both presentations once in `BaseNode`

Derive one shared control model from the existing execution hook and listener state, then expose:

```ts
collapsedExecutionControl?: React.ReactNode
expandedExecutionControl?: React.ReactNode
```

- Apply read-only and `resolveManualExecution` gates once.
- Both callbacks call the same `executionHook.handleSubmit`; do not instantiate another execution hook or register another editor action.
- Preserve required-field validation, credentials, selected input, references, expressions, pins including falsy values, Consolidator state, output publication, and errors.
- Map a live listener to the existing `handleStopListening`; do not invent ordinary request cancellation.
- Correct the render-prop type so the async execution outcome is not erased as `void`.
- A collapsed validation/request failure remains collapsed and updates the established error/output status; no automatic settings or output opening.

### 5. Make `NodeWrapper` own collapsed hover/focus behavior

Add only `collapsedExecutionControl` to `NodeWrapper` and render it inside the collapsed branch at bottom center.

- Use a named card group such as `group/node`; do not let nested label/edit groups trigger visibility accidentally.
- Default to `opacity-0 pointer-events-none`.
- Reveal with `group-hover/node` and `group-focus-within/node`, enabling pointer interaction at the revealed band.
- Keep the button in keyboard tab order so Tab can focus and reveal it even before pointer hover.
- Use a short opacity transition and disable unnecessary motion under reduced-motion preferences.
- Keep the action band inside the card hover boundary so moving from card body to the button cannot hide it.
- Do not condition visibility on `selected`.
- Do not change card geometry when visibility changes.

Layout safeguards:

- reserve bottom space in the collapsed content without increasing size unless measurements prove necessary;
- preserve the read-only bottom-center item badge because no action exists in read-only mode;
- keep the editor tool toggle at bottom right with a non-overlapping hit area;
- verify default 200×150 and AIAgent 320×150 horizontal layouts;
- keep all bottom handles connectable and outside the Play hit target;
- hidden projected cluster members remain `aria-hidden`, unfocusable, invisible, and pointer-disabled.

Do not render an icon action band in the expanded branch.

### 6. Restore the expanded full-width control in form flow

Pass `expandedExecutionControl` to Basic and Repeater layouts through their existing render props and mount it once at the end of each form.

- Place it after fields, dependency controls, validation/error content, and repeater-specific controls.
- Keep it in normal document flow so long forms grow naturally and nothing overlays the final field.
- Keep each existing `<form onSubmit={handleSubmit}>` for keyboard form submission.
- The labelled control itself remains `type="button"` and invokes the shared command directly, preventing click-plus-submit duplication.
- Remove the old independent submit Button implementation and stale Button/Loader imports only after the shared labelled control is in place.
- Preserve authentication dialogs, errors, input/output panels, and the Visualize exclusion through the common resolver.

Exactly one applicable control may be mounted for the current collapsed/expanded state.

### 7. Wire all renderer paths and fix Loop context

- `NodeRouter` forwards only `collapsedExecutionControl` to `NodeWrapper`; its existing layout render receives `expandedExecutionControl` through render props.
- `LoopNode` does the same and explicitly forwards workflow identity and read-only state into `BaseNode` and `NodeWrapper`.
- Search all BaseNode, NodeWrapper, and layout consumers to remove stale names and ensure no renderer is missed.
- Verify nodes inside expanded clusters still resolve their canonical node IDs and execute individually; grouping must not change the action.
- Leave `ClusterExecutionControl`, compact cluster layout, expanded cluster footer, and cluster coordinator unchanged.

### 8. Publish shared lock state reactively

Keep the existing session lock as the concurrency authority, but add a minimal subscribed snapshot keyed by the actual `workflowSessionId` used by `executeEditorNode`.

- Notify subscribers on lock acquire/release/reset.
- Expose active target/phase and blocked reason through `useSyncExternalStore` or an equivalent stable subscription.
- Use the same execution-session key for the control subscription and command; do not substitute the persisted workflow ID unless they are proven identical.
- While another node, cluster, or Run All owns the session, both presentations show blocked state and explain why.
- Command-time lock checks remain authoritative if rendered state is stale.
- Expanding/collapsing during execution switches presentation without releasing the lock, resetting state, registering a duplicate action, or triggering execution.

The visual activation guard is only duplicate-click protection; it must not replace lock ownership.

### 9. Accessibility and interaction details

- Icon control has an explicit accessible name containing the node name; decorative icons are hidden from assistive technology.
- Tooltip opens on hover and keyboard focus.
- Labelled control retains visible Execute/Executing/Stop text.
- Busy controls expose `aria-busy`; blocked controls expose their reason without accepting activation.
- Focus remains stable while Play changes to Spinner/Stop.
- Hover-only opacity must not remove the control from keyboard navigation.
- Hidden cluster runtime hosts and read-only views expose no actionable control.
- Double-clicking the card body still expands; double-clicking the control neither expands nor sends a second request.

### 10. Verification matrix

Browser acceptance should cover:

1. Collapsed idle, hover, pointer transfer to Play, keyboard focus, running, failed, and listener Stop states.
2. Selected and unselected nodes, proving selection is irrelevant.
3. Expanded form with exactly one full-width control, then collapse back to hover-only Play.
4. Basic, Repeater, Loop, trigger/listener, BacktestInit, OnBar, AIAgent, Visualize, sub attachment, and read-only history nodes.
5. Equivalent inputs, request count, exact falsy pinned outputs, errors, and output-panel updates from collapsed and expanded presentations.
6. BacktestInit initializes once and OnBar advances one manual step; neither presentation invokes Run All.
7. Expand/collapse while pending and while listening, with no duplicate request/subscription or state reset.
8. Node versus cluster versus Run All lock conflicts and release after success/failure.
9. Body drag, canvas pan, rename, delete, tool toggle, output/input panels, and bottom-handle connections.
10. Default and AIAgent collapsed geometry, long labels/forms, normal canvas zoom, light/dark themes, and reduced motion.

Run the focused Jest/Vitest-style frontend suites already used by the repository, the relevant Playwright spec through `npm run test:browser -- <path>`, TypeScript checks, lint for changed files, and `npm run build` (which runs node-definition validation). Record exact commands, request counts, screenshots, and outcomes; distinguish unrelated pre-existing failures.

## Delivery order

1. Add capability, component-state, interaction, and parity tests.
2. Add the availability resolver and shared icon/labelled control.
3. Derive the two slots in BaseNode.
4. Wire collapsed hover/focus behavior through NodeWrapper and NodeRouter.
5. Restore the shared labelled control in Basic and Repeater forms.
6. Wire Loop and correct its read-only/workflow context.
7. Add reactive lock state using the real editor session key.
8. Complete browser, geometry, accessibility, execution-parity, and build verification.

## Acceptance criteria

- Collapsed executable nodes show bottom-center Play only on hover or keyboard focus, regardless of selection.
- Expanded executable nodes show one full-width Execute control at the end of the form and no icon duplicate.
- Both presentations invoke the same normal node command and share busy, error, listener, lock, and output state.
- Running a control never changes collapse state or triggers adjacent canvas/card actions.
- Unsupported, projected-hidden, and read-only nodes expose no execution control.
- Cluster controls and execution remain unchanged; only explicit Run All performs batch execution.
- All interaction, accessibility, geometry, lock, and execution-parity checks pass.