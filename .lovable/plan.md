# Expanded cluster execution effects and output-only node errors

## Goal

1. During Execute Cluster, an expanded cluster shows the currently executing member using the normal editor's electric border and connected-edge animation.
2. Execution and required-field failures appear in the failed node's Output Data panel, not in a generic error box inside its configuration form.
3. Keep manual execution, cluster ordering, repeated Loop execution, cancellation, pins, canonical document transactions and drag performance unchanged.

This plan supersedes the preceding Execute All error-stopping plan for the newly attached document. That separate scheduler fix is not included. As requested, this plan contains no test cases or testing sections. No application code has been changed.

## Confirmed findings and corrections

The complete 122-line attachment was reviewed against checkout `a7b80561`.

| Area | Confirmed current behavior | Planned response |
| --- | --- | --- |
| Cluster progress | `useClusterExecution.ts:191–225` publishes `currentNodeId` before an action. Loop body and final Loop calls use this path. Skipped nodes bypass the update. | Reuse progress, but explicitly clear active-member state after settlement; skipped nodes currently leave the prior ID behind. |
| Terminal state | `finish` retains a failed/cancelled node ID; `cancelRun` aborts without a state update until the action settles. | Separate diagnostic IDs from active visual progress. Clear effects immediately on Stop without releasing the execution lock early. |
| Editor running indicator | `WorkflowEditor.tsx:918–930` derives `data.isExecuting` only from normal editor `executingNode`. Its cluster disabled reason also reads that state at `:700–703`. | Do not call `setExecutingNode` for clusters: that can make a cluster block itself. Apply a render-only overlay instead. |
| Existing effects | `NodeWrapper.tsx:323,370` uses `isExecuting`, electric-border settings, dark theme and member-card expansion. `NodeRouter` and `LoopNode` already forward this flag. | Reuse the wrapper; no new animation component or changed theme/expansion policy. Cluster expansion and node-card expansion are distinct. |
| Connections | `workflowExecutor.ts:369–410` highlights connected edges with animation, `executing-edge`, execution-green stroke and width 3. `EdgeManager.tsx:647–657` honors custom stroke in dark mode, while light mode retains its normal neutral color. | Match existing theme behavior rather than promise a green stroke in every theme. Use a semantic CSS token instead of duplicating a literal color in new feature code. |
| Projection | `WorkflowEditor.tsx:708–724` reconciles projection before selecting displayed arrays at `:763–764`; `projection.ts:138` considers focus or view-state expansion. | Apply effects after reconciliation, without changing canonical nodes, projection geometry or committed base references. |
| Required fields | `useNodeExecution.ts:444–451` sets local error and returns failed without publishing output. | Publish the failure envelope before returning; removing the form box alone would hide this diagnostic. |
| Runtime failures | `useNodeExecution.ts:840–898` parses errors, preserves optional code, and publishes to last output, execution store and canonical node data. | Share a narrow failure publisher; preserve existing parsing and Consolidator expiry handling. |
| Output updates | `useNodeOutput.ts:140–168` prioritizes stored output and reacts to store version. `ExecutionContext.setNodeData` only merges state; `useNodeExecution` currently imports no notify hook. | Explicitly notify once after failure publication so other output consumers observe the update. Store mutation alone is not a broadcast. |
| Duplicate diagnostics | BasicNodeLayout `:180` and RepeaterNodeLayout `:1443` render generic execution-error boxes. BaseNode `:577` passes raw error to a control tooltip/live region. | Remove both boxes and use a generic failed-state description on the node control. Preserve field-specific feedback. |
| Output contract | `StandardNodeOutput` recognizes `{success:false,status:"error",error:...}`; OutputPanel already renders these fields. Current catch adds root `timestamp` and optional `code`. | Keep the existing envelope and metadata shape for compatibility; no schema/normalizer migration is necessary. |

Only the document was available for this review; the screenshots it describes were not separately inspected in this turn. The cause of the Backtest ID expression failure remains unconfirmed and outside scope.

## Implementation

### 1. Expose actual active-member progress

In `src/hooks/useClusterExecution.ts`:

1. Return a small derived `activeMember` value containing session, cluster ID and current node ID, or `null` when no member action is in flight.
2. Reuse existing run state and controller ownership. Do not add a global store, event bus, polling timer or new execution engine.
3. Publish the active node immediately before `actionSnapshot.execute` for every real invocation, including repeated Loop/body calls and the Loop's final `done` call.
4. Once the action and its synchronous control-result handling settle successfully, publish progress without `currentNodeId`. Preserve completed/outcome information. This prevents the previous member remaining highlighted while skipped nodes are processed.
5. Keep skipped nodes out of active progress. Never derive an active glow from `outcomes` or a terminal diagnostic ID.
6. On failed/cancelled/completed/blocked state, session replacement or unmount, return no active member. Guard against stale generation/controller ownership before publishing.
7. On Stop, abort the owned controller and narrowly clear the visual current-node indication immediately. Keep `phase: "running"`, the controller and lock until the in-flight action settles; do not enable a second run prematurely.
8. Keep diagnostic `currentNodeId` on terminal failure if useful; the derived visual value must still require running phase, current session/generation and a non-aborted owned controller.
9. Preserve planner, action snapshots, scope, feedback aggregation, safety limits and all existing execution ordering.

### 2. Apply effects only to displayed graph copies

In `src/pages/WorkflowEditor.tsx`, introduce a memoized overlay after `reconcileClusterProjection` and before passing displayed arrays to React Flow.

**Ownership and membership**
- Validate that the active cluster still exists and the current canonical node ID belongs to it.
- Start from the unmodified base displayed nodes/edges, including the collapse-disabled fallback.
- Never call canonical `setNodes`/`setEdges`, `updateNodeData`, history/save commands or `setExecutingNode` to publish cluster visual effects.
- Do not store overlay objects in the committed base-projection reference.

**Node indicator**
- Copy only the active member and its `data` when adding `isExecuting: true`; preserve all other flags, properties and identities.
- Apply the flag to its hidden runtime-host copy as well. Opening the cluster mid-run then reveals the same active member without registering a different runtime.
- Preserve hidden/non-interactive behavior. Do not make hidden hosts selectable or draggable.
- Derive every update from base projection, so clearing/changing the member restores the previous copy without mutating it.

**Edge animation**
- Enable cluster edge effects only when that cluster is expanded according to the exact projection rule: focused ID or `isClusterExpanded`, or members already exposed when collapse is disabled.
- Use canonical IDs and `getClusterEdgeKind` to select internal main edges incident to the active member. Both endpoints must belong to the active cluster.
- Operate only on visible corresponding displayed edges; exclude synthetic boundary routes, hidden edges and attachment/tool/model/resource edges.
- Reuse normal inputs: `animated: true`, append `executing-edge` without erasing existing classes, width 3 and round joins/caps.
- Represent the existing execution-green color with a semantic CSS token in `src/index.css` and reference it in the overlay. Do not hardcode a new color in the helper. Preserve EdgeManager's existing dark/light rendering policy; no edge geometry/theme rewrite.
- Restore exact base styles/classes/animation values when progress ends. Do not globally clear unrelated edge animation.
- Highlight incident main connections while the member executes, as the normal editor does; do not imply an unselected branch already executed or add a completed-edge timeline.

**Performance and placement**
- Put the pure overlay in `src/domain/clusters/executionVisuals.ts` if extraction makes ownership/identity rules clearer; keep it independent of React Flow store subscriptions.
- Memoize from base arrays, session, active cluster/node and expansion. Return original arrays when no overlay applies, and original objects for unaffected items.
- Do not depend on the full outcomes map for overlay recomputation and do not add whole-node-array subscriptions to edges/cards.
- Leave fit-view, canonical selection, insertion hit testing and drag reconciliation on their existing base graph paths.

### 3. Publish every normal action failure to Output Data

In `src/hooks/useNodeExecution.ts`:

1. Add one small local failure-publication helper used by required-field validation and the existing catch path.
2. Preserve the current compatible envelope:

```ts
{
  success: false,
  status: "error",
  error: message,
  timestamp: new Date().toISOString(),
  // Existing optional parsed code remains when present.
}
```

3. Keep the pin short circuit before validation and the catch-path pin protection. Pinned output must not be overwritten or cause a request to be sent.
4. Before publishing, preserve existing abort/execution-generation guards. Do not write cancelled or obsolete results into the replacement workflow.
5. Publish the same envelope through `setLastOutput`, `executionStore.setNodeData` and the canonical `updateNodeData` channel. Do not introduce direct writes to projected node `data`; use canonical updates for the new shared failure path.
6. Add `useExecutionStoreNotify` and notify once after the failure store/canonical update so other consumers refresh. Add the helper/notification to callback dependencies without recreating execution controllers.
7. Keep `setError(message)` for the failed-control state, including caught runtime failures invoked through the cluster snapshot, which do not pass through individual `handleSubmit`.
8. Return `NodeExecutionOutcome` with `status: "failed"`, the original message/code and `output: envelope`. The existing outcome type already permits output; no public execution type change is needed.
9. Preserve detailed JSON error parsing, optional code and `EDITOR_CONTEXT_EXPIRED` handling before publication. Normalize non-Error exceptions safely, without losing server-provided diagnostics.
10. Do not alter required-field rules, visibility filtering, expression resolution, authentication, request payloads or backend output normalization.
11. Keep lock/preflight/scope refusals as control diagnostics rather than inventing node runtime output when no action ran. An actual required-field failure is an action result and must be published.

Publishing output is not permission to change scheduler behavior. Cluster fail-fast/cancellation remains its existing coordinator logic; Execute All's separate continuation defect remains outside this plan.

### 4. Remove duplicate form execution errors

1. Delete only the generic execution `{error && ...}` box from `BasicNodeLayout.tsx` and `RepeaterNodeLayout.tsx`.
2. Remove their now-unused destructured `error` bindings. Keep shared render types/prop contracts unless a change is necessary.
3. In `BaseNode.tsx`, retain the existing failed icon/state but replace raw `executionHook.error` in `statusDescription` with a generic failure description. The current control exposes that value in both a visible tooltip and live region.
4. Do not remove field-specific `FieldWrapper` validation, expression previews, credential/authentication notices, configuration help, listening controls or cluster-level preflight diagnostics.
5. Do not auto-open Output Data, expand the node or reposition panels; the user's existing expansion state governs visibility.
6. Preserve detailed error/code in output even though the configuration form no longer displays the raw message. Existing runtime cluster failure reason remains diagnostic state; no extra node-form notification is added.

## Lifecycle rules

- **Planning:** no member glow before an action starts.
- **Running:** only the current real member invocation is indicated; the same Loop may light repeatedly.
- **Skipped nodes:** no glow and no retained prior active-member indicator.
- **Stop:** effects clear immediately; execution ownership remains until settlement.
- **Failure:** effects clear, failed node output remains, no later cluster node starts under existing fail-fast behavior.
- **Completion:** restore exact base objects/styles and keep outputs.
- **Expand/collapse mid-run:** hidden hosts remain mounted; visible internal edge effects obey current expansion.
- **Session change:** ignore stale progress and guarded late failure publication; do not claim rollback of an already-started remote operation.
- **Normal Execute / Execute All:** preserve existing visual effects and lock behavior when no cluster overlay is active.

## Files and order

1. `src/hooks/useClusterExecution.ts`: active-member derivation, successful-settlement clearing and immediate Stop visual cleanup.
2. `src/index.css`: semantic execution-edge color token only; no new animation CSS.
3. Optional `src/domain/clusters/executionVisuals.ts`: focused render-only overlay; create before importing it.
4. `src/pages/WorkflowEditor.tsx`: memoized displayed arrays driven by active-member progress.
5. `src/hooks/useNodeExecution.ts`: shared guarded failure publication, output envelope and one store notification.
6. `BasicNodeLayout.tsx`, `RepeaterNodeLayout.tsx`, `BaseNode.tsx`: remove generic form diagnostics and detailed node-control tooltip text.
7. Record the render-only overlay/shared-failure-publication architecture rules in `AGENTS.md` when implementing; keep unrelated rules unchanged.

No backend deployment, database migration, API, schema, queue worker, new scheduler, projection/reconciliation change, NodeWrapper rewrite or EdgeManager subscription change is needed.

## Boundaries

- Existing electric-border settings and dark/light theme behavior remain authoritative; this is parity with normal editor effects, not a new always-on animation policy.
- Preserve current timestamp/code shape; migrating every output to a new metadata format is separate work.
- Stored output publication must notify explicitly; a store write alone does not guarantee every panel rerenders.
- No global output-store clearing, pin removal, canonical visual-flag persistence or undo-history entry is introduced.
- Backtest ID expression resolution, Execute All fail-fast, remote rollback and general streaming teardown are separate concerns.
