# Implement two-level nested clusters end to end

## Goal and scope

Support an outer cluster containing inner clusters and directly owned nodes. Users can group nodes inside an outer cluster, wrap sibling root clusters and unclustered nodes, navigate both levels, move either container, insert/paste into the intended body, dissolve safely and run the selected scope.

The initial maximum is **two cluster levels**, confirmed by your answer. Hierarchy traversal remains depth-independent, but both frontend and backend enforce this maximum. No drag-to-reparent interaction is included.

This plan replaces the preceding node-naming plan. Existing naming rules remain authoritative. It contains no test cases or testing sections, as previously requested; no application source is changed by this plan.

## Review findings and improvements

The complete 260-line attachment was checked against checkout `6b053c7e`, not assumed identical to its cited `9b5044d` revision.

Confirmed from current source:
- Cluster types/parsing remain flat. Validators enforce unique direct ownership, reject empty direct lists and run topology on those direct lists. Request schemas require at least one direct member.
- Focus/view state expands one cluster. Projection assigns collapsed owners from flat lists, and focused-frame occlusion cannot distinguish legitimate descendants.
- Selection, editor frames, drag capture and insertion use direct membership. Insertion requires its target to equal the single expanded/focused ID.
- Paste discards copied cluster metadata when targeting a cluster. Node deletion removes zero-direct-member containers; generic invalidation removes entries without promoting children.
- Persistence loads incrementally accepted cluster prefixes, making that approach unsuitable for parent relationships in arbitrary array order.
- Editor execution checks only a violation with the requested cluster ID and plans its direct members. Execution visuals also require direct membership and exclude remapped edge endpoints.
- Server scoped compilation uses direct members. Its hash already includes the requested cluster and source revision; it must additionally describe the resolved hierarchy and leaf scope, rather than claiming parent changes currently bypass revision protection.
- The inspected save service uses ownership/revision checks and an atomic JSONB RPC. Omitting cluster metadata preserves it, but submitting stripped objects or an empty array can erase hierarchy. The checked-in RPC snapshots JSON cluster arrays; hosted deployment is unverified.

Corrections to the attachment/review recommendations:
1. Store parent links only on cluster metadata, **not node data or React Flow `parentId`**.
2. Retain a single focus ID and derive its ancestor path; do not persist a second independent focus-path state.
3. Keep direct ownership unique; ancestor/descendant effective membership overlap is intentional, not invalid overlapping ownership.
4. Preserve all metadata or return a clear refusal for unsupported writers. Never treat a submitted empty array as a silent successful no-op.
5. Add an explicit API write-capability declaration with server enforcement; a new database format-version column is not necessary for the initial hierarchy representation.
6. Parent Execute remains one editor-local sequence of normal node actions. Server-plan compatibility does not route the editor button back through queued Run All.
7. Count and progress semantics distinguish unique leaf nodes from repeated Loop invocations; a parent does not recursively start child runs.

## 1. Metadata and hierarchy contract

Extend `NodeCluster` with optional `parentClusterId`. `memberNodeIds` contains only directly owned canonical node IDs. No cluster/display IDs, duplicated ancestor members or persisted effective-member arrays.

```ts
interface NodeCluster {
  id: string;
  title: string;
  memberNodeIds: string[];
  parentClusterId?: string;
  note?: string;
}
```

Root means an absent parent. Reject explicit null, invalid types, empty parent IDs and parents outside the document, rather than silently stripping them; old flat records already omit the field.

Preserve unique UUID cluster IDs, globally unique titles and the 200-character note limit. Each node has at most one direct owner. Reject self-parenting, cycles and a third level. An effective cluster must contain at least one canonical node; a parent with zero direct nodes is valid when its children supply members.

Keep absolute canonical positions, canonical edges and node identities unchanged by nesting. Connectivity is required only for newly created grouping; persisted disconnected members remain allowed. Retain trigger, attachment, entry/exit, path and supported Loop-boundary restrictions for every effective scope.

## 2. Pure hierarchy resolver and authoritative validation

Add a dependency-free hierarchy helper with indexes for clusters, children, direct node owners, ancestors, descendants, effective members and visible representatives. Index every cluster before resolving links; preserve deterministic output independent of array order.

Detect duplicate IDs/direct ownership, missing parents, self-links, cycles and excessive depth before expanding effective sets. Use iterative traversal or guarded expansion so malformed metadata cannot cause infinite recursion. Report structured diagnostics tied to all affected relationships; never resolve an invalid subtree as if it were flat.

Place the portable source within the backend's supported source boundary and expose a thin frontend re-export, following the existing shared resolver pattern. The backend currently has `rootDir: src`; do not import frontend-only modules into it or create an unrelated packaging migration. Copy the portable source to the separate backend repository at delivery.

Update types, parser, normalization, frontend validation, backend request schema and server normalizer together. Permit empty direct arrays structurally, then validate nonempty effective membership semantically. Check hierarchy before existing graph topology for each effective scope. Connectivity on creation applies only to the new candidate, not every previously persisted disconnected cluster.

Preserve the existing minimum of two effective nodes for grouping; selecting two containers does not excuse invalid leaf topology. Collect exclusively owned attachments during candidate creation, transfer their direct ownership consistently and reject shared attachments that cross the new child boundary.

Build hierarchy indexes only when cluster relationships/membership or canonical node identities change. Position updates must not rebuild effective membership or introduce whole-graph subscriptions in edges/cards. Effective-set storage can cost the sum of subtree sizes; do not claim universal linear complexity.

## 3. Persistence, recovery and compatibility protection

### Full-document loading

Replace prefix acceptance in `useWorkflowPersistence` with complete-array parsing and hierarchy validation. Preserve original source indexes and raw invalid entries so diagnostics still identify the supplied metadata accurately.

Recover only intact valid relationship components when safe; a child must not be rejected because its parent appears later. Structural or cross-component ownership conflicts must not be repaired by guessing. Retain canonical nodes and raw invalid metadata, show diagnostics and block lossy saves until an explicit repair resolves them. Never silently flatten malformed hierarchy.

### Canonical round trips

Preserve `parentClusterId` through normalization, canonical serialization, dirty comparison, API responses, file export/import, workflow versions, local history and run snapshots. A parent-link-only edit must mark the document dirty. Restore a complete document atomically, retaining zero-direct-node parents with children.

Use existing JSONB cluster arrays; no new cluster table, coordinate system or parent-column migration is required. Confirm the deployed RPC/migrations during implementation before enabling writes; source inspection alone does not establish deployment readiness.

### Old-writer protection

Introduce one explicit supported cluster format value, proposed `cluster_format_version: 2`, in create/update request schemas. It is a transient write declaration, not node/cluster content or user identity. Advertise server support and maximum depth through the existing authenticated workflow API response boundary; expose this separately from the document content used for dirty comparison.

At `WorkflowQueryService` before normalization:
- Reject a nesting candidate unless the server supports it and the writer declares hierarchy support.
- For an existing nested workflow, reject graph/document replacement from a writer lacking that support, even when its submitted cluster array looks flat or empty.
- A supported writer may intentionally dissolve all clusters after normal validation; do not silently preserve an empty array.
- Preserve omitted metadata for compatible partial updates, while validating the complete candidate.
- Apply the rule to version restores, import-over-existing and equivalent write paths. Keep expected revision and token-derived ownership authoritative.

Fail closed for nested authoring if capability is absent/unavailable. Keep existing flat workflow writes compatible. Audit alternate/direct writers; if any canonical write bypass exists, close or protect it before release rather than assuming a frontend flag is enough.

## 4. Canonical hierarchy commands

Use one document command per operation for keyboard, context menu and visible controls. Preserve session/drag/execution guards, strict candidate validation and one undo entry per successful mutation; no partial commits or no-op history entries.

### Create an inner cluster

Require selected nodes to share one direct outer owner. Resolve exclusive attachments, transfer selected IDs from the outer direct list into the new child and set the child's parent. Reject attempts inside an inner cluster. Validate the final hierarchy and both child and affected outer topology before commit.

### Wrap root containers and nodes

Keep container selections distinct from leaf selections so a selected cluster remains atomic. Wrap selected root clusters and/or unclustered nodes in a new outer cluster. Link the selected roots to it and directly own the ordinary nodes. Reject partial crossing selections and depth overflow; wrapping a root that already has an inner cluster would create a third level and must fail.

Remove redundant descendant selections when an ancestor is already selected. Reuse unique-title allocation and attachment expansion; do not flatten selected clusters into a new member list.

### Dissolve, delete and ordinary edits

- `dissolveCluster(id)` promotes its direct nodes into the parent direct list, or unclusters them at root; reparent its children to that parent. Preserve nodes/edges.
- Delete-cluster-nodes resolves the complete subtree, deletes each leaf once and removes subtree metadata. Repair ancestors in the same transaction.
- Ordinary node deletion removes direct membership and prunes truly empty containers bottom-up. A parent with children must not be deleted merely because its own member list is empty.
- Replace flat invalidation removal with an explicit promote/revalidate process. Recalculate affected ancestors until the candidate is valid, report every dissolved container, and refuse unexpected structural corruption rather than committing dangling links.
- Node rename updates only direct membership, using the existing identity/reference/runtime transaction; effective sets derive automatically.
- Undo/redo restores nodes, edges, parent links, memberships and runtime-relevant identity state together. Reconcile transient focus to the nearest surviving ancestor.

## 5. Expansion, projection, frames and navigation

Keep one focus ID. Derive expanded IDs from its complete ancestor path. Opening an inner retains its outer frame; closing the inner focuses its parent, and closing the outer returns to root. Add a concise parent/back action or breadcrumb using existing controls. Clear obsolete focus after removal/session replacement without saving view state as document content.

Compute frame bounds bottom-up from visible direct nodes and child compact cards/expanded frames, retaining existing header/footer/padding allowances and absolute coordinates. Parents containing only child containers must still have inspectable bounds. Derive fit-view from the effective visible content without repeated automatic fits during drag.

Projection order:
1. Resolve visibility from the root ownership path: the first collapsed ancestor represents a leaf.
2. Allocate collision-safe synthetic IDs only for visible collapsed containers. Suppressed descendants receive no hidden duplicate card.
3. Map each canonical edge endpoint to its visible representative; suppress edges whose endpoints share one collapsed representative.
4. Preserve canonical edge IDs and per-edge boundary handles/mapping for sibling, inner-to-outer and external connections.
5. Maintain exactly one canonical runtime host per leaf, invisible/non-interactive when hidden, with no duplicate mounts.
6. Reconcile displayed copies using the existing identity-reuse layer; preserve unchanged canonical references.

Make occlusion relationship-aware: legitimate descendants, child cards and ancestor frames cannot hide one another. Keep unrelated intersecting objects under the existing policy, hide orphaned visual connections coherently and make frame stacking/event isolation deterministic. Child header drag/control clicks cannot trigger ancestor drag.

Edge creation, deletion and reconnection must resolve canonical endpoints through projection metadata; never save synthetic IDs or replace canonical arrays with displayed copies.

## 6. Selection, movement and insertion

Resolve selected actionable cluster cards to effective leaves; deduplicate ancestor/child combinations. Select-all excludes hidden hosts and suppressed descendant cards. Preserve explicit selected-container identity for wrap/copy/dissolve rather than inferring it solely from coincident selected leaves.

For compact or expanded container drag, capture every effective leaf's absolute starting position once and apply a single delta. Inner drag moves its subtree; outer drag moves all descendants. Avoid double translation when ancestors and children are selected. Preserve drag cancellation, position-only history, stale-session guards and insertion-hit-test suppression during active drags. Child cards/frames derive positions from canonical leaves rather than moving independently.

Insertion uses the deepest expanded body under the explicit pointer, excluding headers/footers. Member-placement uses that member's direct expanded owner. Explicit insertion into an expanded outer body remains valid while an inner is focused.

Capture session/target intent and revalidate target existence, expanded-path eligibility and full candidate at commit. Replace single-focus equality checks with expanded-ID eligibility. Add new nodes to exactly one direct list; derive ancestors afterward. Retain external fallback placement for actions without a valid explicit body. Keep all dimensions in consistent canvas coordinates, converting screen-fixed allowances once where required.

## 7. Clipboard and portable import

An explicitly selected cluster copies its complete subtree. Ordinary member copying stays supported. Store the source inventory needed for proven alias remapping and copied-root IDs so partial selection cannot produce dangling copied parents.

At paste, use the existing shared instance-name allocator and separate complete node/edge/cluster ID maps. Remap canonical edges, direct members, parent links and supported editable selectors simultaneously. Preserve existing unique-title behaviour.

Attach only copied subtree roots to the destination; preserve internal parents. Standalone copied nodes become direct destination members, not duplicate owners of copied child leaves. Root paste detaches copied roots from uncopied original parents. Remove the target branch that discards copied metadata. Reject depth/topology violations atomically; never flatten to make paste succeed.

File import retains fresh UUID node/edge identities and separately allocated public names under the current naming rules. Preserve or consistently remap cluster UUIDs with all parent links; validate the complete imported array before session replacement. Export/restore retain canonical content, not display cards. Protect import-over-existing through the same supported-writer save boundary.

## 8. Execution, scope and visible progress

At start capture one canonical graph/hierarchy snapshot and resolve the requested cluster's effective leaves. Block preflight on structural defects affecting that component, its descendants or relevant ancestor boundaries; checking only the requested cluster's first violation is insufficient.

Feed the flattened leaf scope into existing editor planning, action capture, allowed-node restrictions, references, attachments and Loop regions. Parent execution owns one lock/controller and invokes each normal action in dependency/control order; **do not call child Execute recursively or queue the editor button**. Preserve BacktestInit single manual initialization, scoped inputs, pins, listener rules, fail-fast and normal Loop feedback repetitions. Unsupported overlapping/nested Loop bodies remain a clear preflight refusal; organizational nesting does not enable them.

Track the active invocation separately from aggregate unique-leaf completion. Repeated Loop body actions do not manufacture duplicate eligible counts. Derive child/ancestor summaries from the owning run's outcomes; do not overwrite independently stored child-run state or start another run. Non-owning controls show the active owner and remain blocked. Stop belongs to the active scope, clears visuals promptly and retains ownership until in-flight settlement. Stale sessions cannot publish late progress/results.

Resolve active leaves to displayed representatives: show normal effects on visible leaves and running/failed state on their visible collapsed child/outer card. Extend `executionVisuals` with effective membership and explicit canonical-to-projected edge mapping, not relaxed endpoint comparisons. Keep effects as overlays after reconciliation; never persist flags/styles or contaminate base projection. Detailed errors remain in the failed leaf's Output Data. Navigation during a run changes display only.

Update the retained backend scoped compiler for effective members, boundaries, attachments, reference limits and plan identity. Include deterministic relevant parent links, direct/effective leaf IDs and planner version alongside existing workflow revision/hash inputs. Persist canonical leaf scope snapshots and existing cancellation ownership. Keep server execution capability restrictions intact; do not promise newly supported node types. Execute All continues scheduling only canonical executable nodes, not organizational containers.

## 9. Delivery order and rollout

1. Portable hierarchy model/resolver, structural diagnostics, frontend/backend validation and parent-preserving parsing/normalization.
2. Complete-document recovery, serializer/import/history/snapshot support and server writer-capability protection.
3. Hierarchy-aware create/wrap/dissolve/delete/paste commands; current naming and runtime identity transactions retained.
4. Ancestor-path navigation, bottom-up bounds, representative edge projection, occlusion and reconciliation.
5. Effective selection/movement and deepest-body insertion integration.
6. Editor flattened execution, derived progress/effects and retained backend scope compiler.
7. Copy backend changes to `coreza-io/coreza-backend`; deploy hierarchy readers/guards before enabling frontend authoring. Inspect deployed RPC readiness and alternate writer paths before the feature gate opens.
8. Enable creation only when server capability advertises hierarchy support and depth two. Rollback disables authoring but retains readers and save protection; never deploy a metadata-stripping writer against nested documents.

Primary files: cluster `types`, new portable hierarchy helper/frontend facade, `parse`, `validate`, `documentCommands`, `viewState`, `projection`, `selection`, `positions`, `insertion`, `executionVisuals`; `WorkflowEditor`, `CompactClusterNode`, `ClusterExecutionControl`, `useClusterExecution`, `useWorkflowPersistence`, canonical serializer/export/version readers; backend `schemas`, `validateNodeClusters`, `WorkflowQueryService`, request/response boundary, scoped compiler and run consumers.

Audit every `memberNodeIds` consumer: direct membership remains correct for ownership/rename; scope, container movement, summary and selection usually require effective membership. Do not mechanically replace all accesses. Record hierarchy/visibility/write-contract architectural rules in `AGENTS.md` during implementation and add the work to the roadmap then; plan mode leaves those files unchanged.

No new execution engine, sub-workflow runtime, all-node identity migration, graph store, whole-node edge subscriptions, drag-to-reparent, commercial gate or automatic flattening is included. This is a source-grounded implementation proposal, not a claim of completed behaviour or deployed readiness.
