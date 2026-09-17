# Build durable cluster persistence

## Goal

Persist every workflow as one consistent document so a saved cluster returns after reload with the same:

- cluster identity, title, note, and member-node order;
- member node configuration and canvas positions;
- internal and boundary connections, including source/target handles;
- workflow-level settings already supported by the editor.

Nodes and connections will remain canonical in the workflow's `nodes` and `edges` arrays. Each cluster will reference its nodes through `memberNodeIds`; it will not duplicate node or edge payloads inside `node_clusters`. This avoids stale copies while still restoring the complete clustered graph.

Cluster expansion/collapse remains local view state and will not dirty or persist the executable workflow. In the current model, persisted cluster settings are `title` and optional `note`; future settings must be added as explicit typed fields rather than an unrestricted object.

## Confirmed baseline

- The deployed database already has non-null `node_clusters` JSON arrays on `workflows`, `workflow_versions`, and `workflow_runs`, plus `workflows.revision`.
- The editor currently sends `nodes`, `edges`, and normalized cluster metadata to Supabase and restores valid cluster metadata on load.
- Version and run snapshots already have initial `node_clusters` plumbing.
- The primary editor save bypasses backend validation, performs an unconditional last-write-wins update, and does not use `revision`.
- Creating a version and updating a workflow are separate operations, so they can partially succeed or race.
- Persistence round-trip, concurrent-save, and browser reload coverage is missing.

## 1. Define one persisted workflow document

Create shared frontend document/serializer types for:

```text
PersistedWorkflowDocument = {
  id
  name
  projectId
  nodes
  edges
  clusters
  revision
}

PersistedNodeCluster = {
  id
  title
  note?
  memberNodeIds
}
```

Use one serializer for save payloads, dirty comparison, versions, and export:

- serialize real executable nodes with configuration, position, supported handles/configuration, and supported pinned output;
- serialize only edges whose endpoints exist, preserving edge ID, source, target, source handle, and target handle;
- normalize cluster titles/notes and membership without inventing or duplicating graph data;
- exclude selection, measurements, callbacks, execution output/status, menus, viewport, drag state, and expansion state;
- deep-clone cluster data so history and in-flight requests cannot be mutated by later edits.

## 2. Make the backend the authoritative persistence boundary

Extend the existing authenticated workflow API rather than writing workflow documents directly from the browser.

### Contracts

- Add `GET /workflows/:workflowId` for an owned workflow document.
- Let create accept the complete serialized document and return the authoritative workflow ID and revision.
- Let update accept the complete serialized document plus `expected_revision`.
- Preserve partial-update semantics for non-editor callers: omitted `node_clusters` keeps stored clusters; explicit `[]` clears them.
- Return the normalized saved document and new revision so the editor can update its baseline from what was actually committed.
- Continue deriving the user exclusively from `req.user.id`; never accept a caller-supplied user ID.

Update the backend database contract so `node_clusters` and `revision` are typed on workflows and `node_clusters` is typed on workflow runs. Because the backend is maintained in the separate `coreza-io/coreza-backend` repository, mirror these backend changes there manually.

## 3. Validate the complete candidate before writing

Expand the backend cluster validator to match the frontend's persisted invariants:

- valid unique UUIDs and case-insensitive unique non-empty titles;
- optional plain-text notes of at most 200 characters;
- unique members, existing member node IDs, and no overlapping ownership;
- trigger exclusion, attachment ownership/boundaries, recognized handles, connectivity, entry/exit, and supported Loop topology;
- exact validation against the merged candidate document, not only the fields present in a partial request.

Return stable reason codes and a clear 400 response for invalid documents. Keep frontend validation for immediate feedback, but treat backend validation as authoritative.

## 4. Save workflow, prior version, and revision atomically

Add a narrowly scoped database function through a migration and invoke it only from the authenticated backend after semantic validation.

For an existing workflow it must:

1. Lock the owned workflow row.
2. Compare its revision with `expected_revision`.
3. Return a conflict without writing when revisions differ.
4. Detect a normalized no-op and return the current document without creating a version.
5. Insert the complete prior `name`, `nodes`, `edges`, `node_clusters`, and active state into `workflow_versions`.
6. Update the complete workflow document and increment `revision`.
7. Commit both operations or neither.

The function must be unavailable to `PUBLIC`, `anon`, and `authenticated`, granted only to `service_role`, and must set a safe `search_path`. Existing table RLS and grants remain unchanged.

For a new workflow, insert the complete document with revision `0` and return the authoritative row. Keep the existing empty-workflow protection, but evaluate it inside the authoritative save path.

## 5. Route editor saves through the API

Refactor `useWorkflowPersistence` to use the authenticated API client for create, update, and load:

- retain the loaded revision in editor state;
- send one immutable snapshot containing nodes, edges, clusters, and settings;
- use the returned document and revision as the saved baseline;
- if edits occur while a save is in flight, acknowledge only the submitted snapshot so newer changes remain dirty;
- serialize saves per workflow or disable duplicate save submissions;
- show a conflict message on HTTP 409 without overwriting local edits, with actions to reload the stored workflow or keep the local draft for a later retry;
- use the same save function for the Save button, tab-hide preservation, and execution-before-save path;
- apply the existing loading/invalid-metadata guards to every save entry point.

Do not silently discard malformed persisted cluster metadata. Keep the existing recovery banner and block replacement until the user explicitly removes or repairs those entries.

## 6. Restore the exact clustered document

On load:

1. Fetch the owned workflow through the backend.
2. Parse cluster JSON structurally.
3. Rehydrate node definitions and dynamic handles.
4. Rehydrate edge callbacks without changing persisted endpoint IDs or handles.
5. Validate clusters against the fully rehydrated graph.
6. Restore nodes, edges, clusters, revision, and saved hash together.

A valid save/reload round trip must preserve:

- every cluster ID, title, note, and member ID;
- every member's values and position;
- every internal and boundary edge ID and handle;
- cluster-only edits even when nodes and edges did not change.

Legacy rows with missing cluster metadata load as `[]`. Invalid metadata remains visible for explicit recovery rather than being silently overwritten.

## 7. Keep history, import/export, and execution snapshots consistent

- Version creation and workflow update use the atomic save operation.
- Version restore reinstates nodes, edges, and clusters from the same snapshot and becomes an unsaved editor document until saved.
- Import/export uses the same persisted serializer/parser and remaps cluster membership only when node IDs are remapped.
- Manual and backtest run creation continue storing the exact saved `node_clusters` snapshot.
- Audit scheduler, streaming, webhook, and recovery run creators; every run snapshot must include clusters from the same workflow read as its nodes and edges.
- Runtime execution continues receiving canonical real nodes and edges only; clusters are descriptive snapshot metadata and must not alter execution order.

## 8. Regression and acceptance coverage

### Frontend/domain

- serializer preserves node values/positions, edge IDs/handles, title, note, and membership;
- cluster-only changes alter the dirty hash;
- view-only expansion, selection, viewport, and runtime status do not alter it;
- strict parsing covers legacy empty metadata and malformed recovery entries;
- import/export and version restore preserve cluster metadata.

### Backend/API

- create and update persist the complete cluster document;
- partial update omission preserves clusters while explicit `[]` clears them;
- invalid membership/topology is rejected before any write;
- stale revision returns 409 and leaves workflow/version rows unchanged;
- successful save creates exactly one prior version and increments revision once;
- no-op save creates no version;
- injected version/update failures commit neither side;
- run snapshots preserve the matching clusters.

### Browser acceptance

Using an authenticated preview:

1. Create two connected nodes and a cluster.
2. Edit the cluster title and note, move its nodes, and save.
3. Reload the page and verify the same frame, members, positions, connections, handles, title, and note.
4. Change only the cluster note, save, reload, and verify it survives.
5. Open the same workflow in two sessions and verify a stale save is rejected instead of overwriting the newer cluster.
6. Restore a prior version and verify its clustered graph is restored as one document.

## Completion gate

Cluster persistence is complete only when manual save, tab-hide save, execution-before-save, reload, version restore, import/export, and run snapshots all preserve one matching nodes/edges/clusters document, and concurrent saves cannot silently lose cluster changes.
