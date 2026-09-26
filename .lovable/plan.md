# Restore cluster collapse and expand

## Confirmed cause

- `CLUSTER_COLLAPSE_ENABLED` is hard-coded to `false`.
- The expanded header renders its collapse button only when that flag is enabled.
- The editor also bypasses the compact cluster projection while the flag is disabled, so the compact card and its expand button can never appear.
- The flag was intentionally disabled because collapsing currently removes member node components, while manual execution and listener registration still live inside those mounted components.

## Implementation

### 1. Preserve member runtimes while visually collapsed

- Extend the cluster display projection so collapsed member nodes remain mounted as runtime hosts instead of being removed from React Flow.
- Return the compact card and display-only clones of its canonical members in one projection update. Mark the member clones as collapsed presentation hosts while leaving the canonical document untouched.
- Hide those presentation hosts immediately with `visibility`, pointer, focus, and accessibility rules—never an opacity, transform, layout, or exit animation. This prevents the compact card and visible member cards from sharing a painted frame, which is the overlap/delay shown in the screenshots.
- Keep stable member keys across both views so React Flow updates visibility rather than asynchronously removing and recreating member renderers.
- Exclude collapsed presentation hosts from selection, dragging, connection handling, keyboard focus, deletion, fit-view bounds, and the minimap.
- Keep canonical node IDs, data, positions, outputs, execution registrations, and listeners unchanged.
- Continue suppressing internal display edges and project cluster boundary edges to the compact card using the existing collision-safe display IDs and canonical endpoint metadata.
- Keep the collapsed presentation marker projection-only; never serialize it, hash it as a workflow edit, expose it to execution payloads, or copy it into history.

### 2. Re-enable the paired cluster controls

- Enable cluster collapse only after the mounted-runtime projection is in place.
- Keep the collapse chevron permanently visible in the expanded cluster header.
- Keep the expand chevron permanently visible in the compact cluster card.
- Commit each toggle as one synchronous view-state change; do not use timers, staged removal, delayed effects, or animation callbacks to swap representations.
- Preserve the existing node-style interactions: compact-card double-click and `Enter`/`Space` expand; the chevrons use `aria-expanded`, `aria-controls`, labels, and tooltips.
- Stop pointer and click propagation so either button changes only the cluster view and never starts a drag, selects a node, executes the cluster, or pans the canvas.

### 3. Keep collapse as view-only state

- Reuse `clusterViewState`; do not write expanded/collapsed state into workflow nodes, edges, clusters, versions, or run snapshots.
- Newly created clusters remain expanded for naming.
- Loaded clusters use the existing compact default unless explicitly expanded during the current editor session.
- Toggling must not move canonical members, create an undo entry, mark the workflow dirty, save, or change its revision.
- Expanding must restore the exact canonical member nodes, edge IDs, endpoints, and handles.

### 4. Complete compact interaction parity

- Verify compact selection maps to all canonical members without leaking the synthetic display ID into commands.
- Verify compact dragging moves each canonical member once and creates one position-history entry.
- Expand the owning cluster before focusing or executing a real member from editor actions.
- Keep the existing shared cluster run control and run state unchanged while switching between compact and expanded views.

### 5. Regression coverage

Add focused tests proving:

- the collapse capability is enabled only with mounted-runtime preservation;
- expanded clusters expose the collapse control and compact clusters expose the expand control;
- collapsed members stay mounted but are invisible and non-interactive;
- one collapse update immediately yields one visible compact card and zero visible member cards, with no intermediate overlap frame;
- repeated collapse/expand cycles do not duplicate or remove auto-execution listeners;
- a node inside a collapsed cluster can still receive an editor execution event and publish its result;
- projected boundary edges retain canonical IDs, endpoints, and handles, including cluster-to-cluster edges and display-ID collisions;
- toggling does not mutate the canonical workflow document, revision, dirty state, or history;
- compact selection, drag, context menu, execute button, and expand button remain isolated from one another.

### 6. Browser acceptance

In a signed-in workflow containing a multi-node cluster:

1. Confirm the expanded header shows the collapse icon without hover.
2. Collapse it and confirm one compact card replaces the visible members, with the expand icon and cluster run button visible.
3. Capture the transition frame-by-frame and confirm no member card remains visible behind the compact card and no card shifts after the click.
4. Run the cluster while compact and confirm status/output updates without expanding it.
5. Expand it and confirm the original nodes and connections return immediately at unchanged positions.
6. Repeat toggling during normal editor execution/listening and confirm execution continues once, with no lost or duplicate events.
7. Save and reload to confirm the workflow document remains intact and the default cluster view is applied without persisting display-only state.
8. Check desktop and narrow viewports for clipped or overlapping header/footer controls.

## Completion criteria

- Both collapse and expand icons are visible and functional.
- Collapse and expand swap representations in one paint without overlap, delayed movement, or flicker.
- Collapsing never unmounts the runtime behavior required by member nodes.
- Compact and expanded views preserve the same canonical workflow, execution state, outputs, and connection semantics.
- Focused tests and the preview build pass with no new console or runtime errors.
