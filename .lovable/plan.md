# Transactional clustered-node rename

## Goal

Renaming a node—inside or outside a cluster—must be one canonical document transaction. A successful rename preserves the node, position, configuration, outputs, references, edges, handles, selection, and cluster membership under the new identity. A failed rename changes nothing.

The reported clustered-node rename must never enter the connection-edit path, show **“Connection would invalidate a cluster”**, or offer to dissolve the cluster.

Keep overlap-only cluster visibility, collapse/expand behavior, and Execute/Play controls unchanged.

## Validated diagnosis

The source confirms an architectural bypass:

- `useNodeRenaming` reads React Flow nodes and calls `setNodes` and `setEdges` separately.
- That hook renames the node ID and display name, then separately rewrites edge endpoints; it never updates `cluster.memberNodeIds`.
- The editor’s canonical graph is the authority for cluster projection, validation, save/history, input traversal, and execution.
- `filterCanonicalNodeChanges` correctly rejects projected `add`/`replace` changes while accepting canonical `remove` events. An ID replacement emitted through React Flow can therefore contribute to the disappearance, but the exact emitted event sequence still needs browser instrumentation before claiming it as the sole mechanism.
- `renameNodeInDocument` already rewrites node IDs, exact edge endpoints, and cluster membership, but it delegates to `mutateDocument`, whose policy dissolves newly invalid clusters. It does not update `data.displayName`, reject a missing source, define no-op behavior, or return identity metadata.
- `commitEdgeCandidate` validates edge-only edits against current nodes/clusters and owns the reported connection/dissolve toast. Rename must not call or re-enter it.
- The execution store, pinned-output map, editor action registry, expression selectors, and local upstream selections are keyed by node ID and require an explicit rename policy.

The screenshot proves visible disappearance and the wrong toast. First reproduce while recording canonical node count, projected nodes, edges, membership, history, and serialized save data; do not infer that persisted data is already damaged or reconstruct a missing node from the screenshot.

## Rename contract

1. Rename remains an identity rename for compatibility: the canonical node `id` and `data.displayName` both become the collision-resolved name.
2. The request is resolved against the complete canonical document, never projected React Flow nodes.
3. All document changes are validated before any state, history, output, selection, or registry mutation.
4. Success commits once and creates one undo entry.
5. Failure retains the draft name editor and leaves the complete editor/runtime state unchanged.
6. Rename is unavailable in read-only views, during any editor execution, during structural cluster dragging, and while the source owns an active listener/stream whose backend identity cannot be safely changed.
7. Temporary cluster visibility and execution presentation are outside this change.

## Implementation plan

### 1. Reproduce and instrument the exact failure

Create a focused browser fixture or test workflow with an expanded cluster containing a Store node with internal and boundary edges.

Capture before and after one inline rename:

- canonical nodes/edges from the stable canonical store;
- projected nodes and React Flow `NodeChange`/`EdgeChange` deltas;
- cluster member IDs and focused cluster ID;
- history depth and serialized workflow content;
- execution-store entry and pinned output for the source ID;
- toast title/body.

Confirm whether React Flow emits remove/replace deltas, whether the canonical node is actually deleted or only projected away, and whether a subsequent save contains damage. Use these observations to guard the regression test, not to alter the transactional design below.

### 2. Add a narrow editor-owned rename command channel

Extend `StableNodeContext` with a typed imperative rename operation following the existing registered updater pattern:

- request: `{ nodeId, requestedName }`;
- result: discriminated success/failure with `oldId`, final `newId`, `changed`, and a user-safe error message/code;
- `renameNode(...)` calls the current registered editor handler;
- `registerNodeRenamer(...)` installs and cleans up the handler for the mounted workflow editor/session.

The context is only a command bridge. It must not derive canonical state, mutate React Flow directly, or contain cluster policy.

In `WorkflowEditor`, register the handler against current refs for canonical nodes, edges, and clusters so invocation never uses a projected graph or stale closure. Keep refs synchronized for all three document collections. Reject before planning when:

- the view is read-only or loading;
- the workflow session no longer matches;
- a node/cluster/workflow execution lock is active;
- a cluster drag or other structural operation is active;
- the source ID is missing or begins with the reserved compact-cluster display prefix;
- the source has an active listener/test-listener/stream state that cannot be rekeyed safely.

Return a rename-specific failure. Never fall back to direct `useReactFlow().setNodes/setEdges` writes.

### 3. Centralize name validation and collision resolution

Move the existing rename rules into a pure helper used by the editor command and tests:

- trim surrounding whitespace;
- reject empty names;
- enforce the existing 50-character maximum;
- preserve the existing allowed-character rule: letters, numbers, spaces, hyphens, and underscores;
- compare case-insensitively against every canonical node ID and `data.displayName`, including collapsed/temporarily hidden nodes;
- exclude only the source node from collision checks;
- ignore synthetic compact-card IDs and cluster titles because they are not node names;
- preserve the current suffix convention (`Name1`, `Name2`, …), checking both IDs and display names for each candidate;
- reject any final identity using the reserved cluster display prefix;
- treat a final ID/display name already equal to the source’s current identity as a no-op.

Return the resolved final name before constructing the document candidate so UI, history, references, and runtime migration all use one mapping.

### 4. Make `renameNodeInDocument` a strict atomic command

Strengthen `renameNodeInDocument` instead of creating a competing ID-remap utility. Give it an explicit rename result containing the candidate document and `{ oldId, newId }`; do not use the auto-dissolving `mutateDocument` path.

The pure command must:

1. handle `oldId === newId` as a no-op before collision checks;
2. reject a missing source node;
3. reject an occupied destination ID;
4. clone the canonical document without mutating any input node, edge, nested data container being changed, or cluster member list;
5. update exactly one node’s `id` and `data.displayName` while preserving type, definition, values, field state, credentials/configuration, output/pinned data, position, dimensions, selection, and all unrelated data;
6. rewrite exact `edge.source` and `edge.target` matches while retaining edge IDs, types, source/target handles, and data;
7. replace exact old IDs in every cluster membership list while preserving cluster ID, title, note, order, and count;
8. apply supported reference remapping described below to the same candidate;
9. validate the complete candidate before returning it;
10. return failure without a candidate when the rename introduces any new semantic violation.

Do not rewrite arbitrary substrings in edge IDs. Edge IDs are independent graph identities. Do not call `commitEdgeCandidate`, suppress cluster validation, or dissolve a cluster to make rename succeed.

For workflows that already contain invalid cluster metadata, compare violation fingerprints before and after after normalizing the destination ID back to the source ID. Permit only equivalent pre-existing violations; reject new codes, clusters, edges, or affected node sets. This preserves the editor’s existing tolerance without falsely treating the renamed identity as a new violation.

### 5. Remap only supported node references

Audit confirms expressions support exact node selectors in these forms:

- `$('Node Name').json...` and `$("Node Name").json...`;
- `$node['Node Name'].json...` and `$node["Node Name"].json...`.

Add a small parser/remapper beside the existing reference utilities. It must walk only persisted/editable node value structures and replace the selector token when its decoded name exactly equals the old ID/display name. Preserve quote style and the rest of the expression. Support multiple references in one string.

Rules:

- recursively inspect arrays and plain objects under canonical editable `data.values` and its current draft mirror `data.fieldState`;
- do not globally replace arbitrary strings, object keys, user code, labels, JSON payloads, outputs, pinned outputs, credentials, or unrelated text;
- do not rewrite `$json` references because they are input-relative;
- leave escaped or malformed templates untouched and test them;
- if a value contains a recognized reference form that targets the old identity but cannot be safely parsed/remapped, reject the rename before commit with a clear explanation;
- keep the remapped values in the same document/history transaction so undo/redo restores dependencies with identity.

Test both ID- and display-name-based selectors, mixed strings, both quote styles, nested arrays/objects, multiple references, similar-name nonmatches, and malformed expressions.

### 6. Preflight runtime migration before document commit

Add an atomic `renameNode(oldId, newId)` operation to `ExecutionContext` that moves both:

- the node execution-data map entry;
- the pinned-output map entry.

It must reject a destination collision, preserve falsy outputs and all listener/Loop fields, delete the old keys only after validation, and expose a testable no-op. Because active listeners are blocked, this migration handles retained completed/manual state rather than pretending to retarget an external subscription.

Before changing the document, preflight that the destination is free in:

- canonical node IDs;
- execution data/pinned maps;
- editor node-action registry.

Do not migrate a running action. The execution lock rejection is mandatory.

For registered editor actions, do not move the old callback to the new key because it closes over the old node ID. Let the renamed component register a fresh callback for the new ID. Add the smallest session-scoped registry cleanup handshake: once the new action is registered, retire the old ID; until then, the old callback cannot be selected by the renamed canonical graph. Keep the existing collapse/unmount retention policy for ordinary registrations.

Notify execution-store subscribers once after successful rekey so output panels immediately read the preserved output under the new ID.

### 7. Commit the canonical document once

The editor handler must perform this sequence synchronously within one user event:

1. read one current canonical `{ nodes, edges, clusters }` snapshot;
2. validate guards and resolve the final name;
3. build/validate the complete rename candidate;
4. preflight runtime and registry destination keys;
5. push exactly one pre-edit document history snapshot and clear redo;
6. migrate execution-store data/pin identity;
7. apply candidate nodes, edges, and clusters together through one editor-owned document restore/apply function;
8. notify runtime subscribers and return success.

React’s batched state update may use the existing `restoreDocument`, provided all three candidate collections are scheduled in the same handler and no intermediate publication/event path occurs. `useCanonicalGraphSync` must subsequently publish matching candidate nodes and edges. Do not route candidate edges through `onEdgesChange` or `commitEdgeCandidate`.

If any operation can fail after preflight, add rollback for runtime identity and history, or reorder it so all fallible work precedes mutation. The observable contract is all-or-nothing.

Preserve editor-local state:

- keep the same focused cluster ID; remapped membership keeps the renamed node a member;
- keep position, selected state, expanded node-local state where React identity permits, and cluster selection;
- remap editor-level selected/open node IDs and pending target IDs if present;
- allow local upstream selectors to reconcile from canonical edges; explicitly test any state that stores the old selected upstream ID;
- close the rename editor only after success.

Do not loosen `filterCanonicalNodeChanges` to accept arbitrary projected replacements. The rename must bypass React Flow change deltas entirely.

### 8. Make the rename hook single-shot and projection-independent

Refactor `useNodeRenaming` to use `useStableNodes().renameNode` and remove its `useReactFlow` dependency for identity mutation.

- pass/read the node’s `readOnly` capability so editing cannot start or commit in read-only views;
- keep F2 and the existing inline/double-click entry point on one hook;
- track the source node ID captured when editing begins;
- set a commit-in-progress ref before invoking the command;
- make `finishEditing` asynchronous and idempotent so Enter followed by blur sends one request;
- on success, close/reset the editor and show one success toast with the resolved final name;
- on failure, keep the draft and focus available, show one rename-specific error, and permit correction/retry;
- Escape cancels without any command;
- whitespace/no-op closes without history or success mutation;
- if the editor handler is unavailable, fail clearly rather than using projected writes.

The inline input must stop pointer/double-click propagation and keyboard propagation for Enter, Escape, Backspace, and Delete. The existing editor shortcut guard already ignores `input`, `textarea`, and `contenteditable`; retain it and add a browser assertion so text deletion never deletes the node.

### 9. Keep canonical projection and persistence boundaries intact

- Cluster projection consumes the remapped canonical node/edge/membership snapshot; it never receives a half-renamed graph.
- The focused cluster remains open and the renamed member remains visible under overlap-only behavior.
- Save/export uses the renamed canonical ID, exact edge endpoints, updated membership, and remapped supported values.
- No projected hidden styles/classes, synthetic IDs, focus state, runtime maps, or callbacks enter persistence.
- Undo restores old node identity, edge endpoints, cluster membership, and references together; redo reapplies them together.

Extend document-history restoration with the same runtime identity reconciliation used by rename when undo/redo changes a node identity. Do not allow undo to restore document IDs while leaving outputs/actions only under the opposite ID. If history entries need explicit rename metadata to perform this safely, add it to the editor-local history entry, not the persisted workflow schema.

No backend route, database migration, workflow schema, cluster metadata format, queue, or execution contract changes are required.

## Test plan

### Pure command and reference tests

- clustered rename preserves node count, node data, position, handles, exact edge IDs/data, endpoints, cluster metadata/order, and input immutability;
- unclustered rename follows the same command;
- missing source, occupied destination, reserved synthetic prefix, invalid name, and newly introduced cluster violation return failure with zero mutation;
- no-op returns unchanged with no history requirement;
- equivalent pre-existing invalid metadata remains tolerated without dissolution;
- supported reference selectors remap exactly; similar names, malformed templates, `$json`, outputs, arbitrary text, and object keys do not;
- undo candidate restores the entire old identity/dependency graph.

### Context, runtime, and hook tests

- stable context forwards one typed request to the current editor handler and reports unavailable-handler failure;
- execution data and pinned outputs rekey atomically, including falsy values and destination-collision failure;
- a new editor action registers under the new ID before the old callback is retired;
- active execution, structural drag, read-only mode, and active listener/stream reject with no mutation;
- Enter plus blur invokes one command and adds one history item;
- failure keeps the draft; Escape cancels; Backspace/Delete edit text only;
- duplicate checks include hidden canonical IDs/display names and resolve one deterministic suffix.

### Browser acceptance

Using the actual node renderer and inline input:

1. Expand a cluster containing a configured Store node with incoming/internal/outgoing edges, a retained output, a pin, and a supported downstream reference.
2. Rename it and assert one visible member remains at the same position with the new title.
3. Assert canonical node count, edge count/IDs/handles, membership count, cluster focus, configuration, output/pin, and downstream reference are preserved/remapped.
4. Assert neither the connection-invalid toast nor dissolve action appears.
5. Collapse/reopen repeatedly; the node remains in the same cluster and visibility follows only overlap rules.
6. Execute the renamed node and Cluster Execute; both resolve the new action/data and produce normal output.
7. Undo/redo and verify document plus runtime output identity move together.
8. Save, reload, and export; no orphaned endpoints/membership or old supported references remain.
9. Try duplicate, invalid, missing/stale, active execution, and active listener cases; all leave graph/history/runtime unchanged.
10. Verify an unclustered rename has identical semantics.

Run focused Jest suites for document commands, reference remapping, canonical node filtering, canonical graph context, execution store, editor actions, and rename-hook behavior; run the targeted Playwright reproduction; then run changed-file lint, the configured TypeScript check, and frontend build. Record unrelated baseline failures separately.

## File-level scope

| Area | Planned change |
| --- | --- |
| `src/hooks/useNodeRenaming.ts` | Typed editor command, async single-shot commit, read-only/error/event handling; remove direct React Flow mutation |
| `src/contexts/StableNodeContext.tsx` | Register/invoke the current editor-owned rename handler |
| `src/domain/clusters/documentCommands.ts` | Strict immutable rename transaction and violation-equivalence validation |
| Reference utility | Exact supported-selector remapping inside editable values |
| `src/utils/executionContext.ts` | Atomic execution-data and pinned-output rekey |
| `src/services/editorNodeExecution.ts` | New-registration/old-ID retirement handshake without weakening collapse retention |
| `src/pages/WorkflowEditor.tsx` | Current canonical refs, guards, one history snapshot, runtime preflight/rekey, one document commit, undo/redo reconciliation |
| Node renderer/input | Forward read-only state and isolate rename-input events where not already covered |
| Focused unit/browser tests | Transactionality, references, runtime identity, clustered reproduction, undo/save/execution regressions |

## Implementation order

1. Reproduce and capture the actual canonical/projected delta sequence.
2. Add pure name, reference-remap, and strict document-command tests.
3. Implement the strict canonical rename candidate.
4. Add stable-context command registration and replace direct hook writes.
5. Add execution-store/action identity migration and editor preflight/atomic commit.
6. Make editing single-shot and verify keyboard/read-only/listener guards.
7. Add undo/redo, save/reload, execution, cluster-focus, and overlap regression coverage.
8. Run focused checks, browser acceptance, lint/type checks, and build.

## Acceptance criteria

- Renaming a clustered node never removes it, projects it as an outsider, or dissolves its cluster.
- No rename reaches the connection-invalid toast or edge-only validation path.
- Success updates node ID/display name, exact edge endpoints, membership, supported references, runtime outputs/pins, and action identity as one logical transaction.
- Failure or rejection leaves nodes, edges, clusters, history, selection, runtime data, and persistence unchanged.
- Enter/blur produces one commit and one undo entry.
- Undo/redo and save/reload preserve a valid, executable canonical graph.
- Existing overlap-only visibility and Execute/Play behavior remain unchanged.