# Coreza frontend: consolidated optimization implementation plan

Date: 22 October 2026  
Repository: `Coreza-io/coreza`  
Target branch: `dev` only  
Verified source baseline: `37fd584356ab81a40e2e503c548e7b4e40c5668b`  
Status: plan only; implementation and browser performance measurements remain outstanding.

## 1. Outcome and scope

Make the Coreza editor responsive while dragging, panning, typing, inspecting results, and running workflows. Restrict React updates to the components that use the changed state; reduce repeated loading and retained data; preserve execution correctness and existing document contracts.

This consolidates the frontend review's F01–F19 findings and the follow-up component/state-rendering assessment into one ordered implementation plan. It covers:

- React component boundaries, local state, context subscriptions, derived values, effects, callback identity, and memoization;
- canonical graph, topology indexes, runtime state, result publication, and execution snapshots;
- credential/options loading, expression previews, input/output panels, and history stability;
- session disposal, sockets, undo/clipboard retention, hidden cluster members, and large datasets;
- charts, Loop aggregation, route loading, logging, and supporting pages.

The primary implementation is frontend-only. Preserve backend execution, variable persistence, database schemas, broker behavior, and wire formats. Optional backend aggregation or revision support for surrounding pages is a separate, explicitly justified follow-up if existing interfaces cannot provide the required bounded data. Do not add a state-management library or upgrade React as a prerequisite.

## 2. Verified baseline and consolidation decisions

The previous review inventoried 233 TS/TSX/CSS source files and four repository/configuration files. All 237 downloaded files matched their GitHub blob hashes. `dev` was checked again while preparing this plan and remains at the reviewed commit.

The isolated source probes establish the following behavior; they are not browser FPS, heap, or React commit measurements:

| Trigger | Reproduced behavior | Required correction |
| --- | --- | --- |
| Reconnect A → B to A → C without changing counts | The memoized executor retains B | Capture the accepted run's current graph and actions |
| Edit an unrelated symbol field in the credential fixture | Two credential requests plus one dependent account request | Request by exact resource dependencies, with one owner |
| Publish one output change in a 300-node graph | All 300 semantic listeners notified; semantic record identities rebuilt | Introduce narrow graph/runtime views and migrate consumers |
| Change only node position | No semantic notifications | Preserve this existing optimization |
| Refresh separate but identical JSON with 5,000 OHLCV rows | `sameExecution` returns false after its traversal budget | Use bounded selected-detail identity and loading |
| Resolve socket authentication after effect cleanup | A socket opens after disposal | Recheck generation after async setup and own every resource |

### Preserve work already implemented

The October 7 drag-lag plan contains historical status statements that no longer describe this commit. Endpoint-only edge subscriptions, projection reconciliation, synchronous drag guards, and requestAnimationFrame-coalesced execution visuals are already present. Verify them; do not reimplement them.

The October 22 history-input plan also describes earlier selection feedback loops. Current source already derives historical options from saved topology, has a read-only selection guard, memoizes selected executions, and uses an isolated static store. This plan preserves the current saved-topology/upstream policy, including unexecuted branches with explicit missing-output states. Do not restore the older executed-nodes-only policy.

The remaining history work concerns heavy list payloads, large-record identity loss, live-version subscriptions leaking into static consumers, repeated whole-run indexes, and async scope races.

Broker authentication-message formatting remains in the separate broker-auth plan. Edge thickness, deletion, and hover product behavior remain in the separate edge plan; this work supplies regression coverage without redesigning those features.

### Principal source locations

- `src/pages/WorkflowEditor.tsx`: editor state, canonical data updater, run acceptance, graph projection, viewport, history, undo, load lifecycle.
- `src/contexts/canonicalGraphStore.ts`, `StableNodeContext.tsx`: graph publication and subscriptions.
- `src/contexts/ExecutionStoreContext.tsx`, `StaticExecutionStoreContext.tsx`, `src/utils/executionContext.ts`: runtime snapshots, notification, sockets, historical isolation, aggregation.
- `src/components/nodes/BaseNode.tsx`, `NodeRouter.tsx`, `src/utils/NodeWrapper.tsx`: node hook ownership, shell, configuration/panel mounting.
- `src/hooks/useNodeCredentials.ts`, `useNodeFieldState.ts`, `useNodeOutput.ts`, `useNodeReferences.ts`, `useNodeExecution.ts`: node state, requests, previews, publication.
- `src/components/nodes/layout/BasicNodeLayout.tsx`, `RepeaterNodeLayout.tsx`, and `layout/components/NodeFieldRenderer.tsx`: field/render dependencies.
- `src/services/editorNodeExecution.ts`: locks, session actions, `captureEditorNodeActions`, identity retirement.
- `src/utils/workflowExecutor.ts`: captured graph, scheduler, visuals, execution lifecycle.
- `src/hooks/useExecutionHistory.ts`, `src/components/workflow/ExecutionDetailView.tsx`, `ExecutionHistoryPanel.tsx`: historical data and presentation.

Use the verified baseline's [source tree](https://github.com/Coreza-io/coreza/tree/37fd584356ab81a40e2e503c548e7b4e40c5668b/src) and root [AGENTS.md](https://github.com/Coreza-io/coreza/blob/37fd584356ab81a40e2e503c548e7b4e40c5668b/AGENTS.md) when implementing. Reconcile subsequent `dev` changes before editing.

## 3. Architecture requirements

1. Canonical document commands remain authoritative. Projected React Flow nodes/edges are render-only. Preserve nested hierarchy, invalid-metadata recovery, canonical identity naming/remapping, and one undo entry per structural command.
2. Retain the required guarded publication of failures/results to local output, execution store, and canonical node data, followed by one explicit store notification. This plan narrows subscriptions around that contract; it does not delete canonical result publication.
3. Keep the existing full and semantic graph APIs compatible while introducing narrower views. Legacy semantic consumers must still detect relevant data/output/pin changes, including currently supported top-level in-place mutation detection, until deliberately migrated. Do not silently redefine `subscribeSemantic` to mean topology only.
4. Every hidden canonical leaf retains its required runtime/action availability. CSS visibility is presentation state. Do not enable culling or unmount runtime hosts before runtime ownership is detached safely.
5. Manual and Cluster Execute use normal node actions. Parent Cluster Execute has one captured effective scope/controller/lock and repeats Loop bodies correctly. Explicit Run All retains its existing scheduling route.
6. Preserve output envelopes, false/null/zero/empty-string precedence, pins, missing-value distinctions, input selection, and immutable publicly exposed snapshots.
7. Keep current expression semantics, bounded computed-slice parsing, complete canonical identity inventory, `$vars` ownership, and action-context snapshots. Previews remain read-only; no evaluator I/O or new variable persistence path.
8. Structural mutation guards continue to read current session/drag/loading/execution state. Optimized callbacks must not retain stale permission or document data.
9. Coalesce presentation only. Do not drop/reorder authoritative execution results, listener/replay events, errors, broker actions, variable commits, or terminal status.
10. Preserve position accuracy throughout drag, source/target edge routing, projected endpoint mapping, nested cluster visibility, and selection/focus behavior.

The required canonical result mirror means some canonical/React Flow publication work remains. The goal is to avoid making that publication invalidate unrelated topology/configuration consumers, and to reduce its measured cost. Do not promise that every output update becomes O(1) across the whole controlled canvas immediately.

## 4. State ownership and component rendering contract

### 4.1 Owners

| State | Owner | Subscription boundary |
| --- | --- | --- |
| Editable document, node IDs/configuration, pins, hierarchy | Current document/session | Commands and per-node editable/configuration selectors |
| Positions/dimensions | Current canonical geometry + canvas projection | Geometry consumers and affected endpoint/frame selectors |
| Topology/connection indexes | Document structure revision | Ancestor IDs, incident edges, dynamic-handle/role consumers |
| Runtime output/status/progress | Session execution store | Per-node output, per-node status, explicit reference/source dependencies |
| Run lock, target, controller, accepted graph/actions | Session execution controller | Run controls and relevant progress presentation |
| Viewport | Small canvas/overlay owner | React Flow and cluster frame presentation |
| Field draft/caret/editor interaction | Open configuration control | That field/form; retain existing canonical write timing |
| Expanded node/panel/search/scroll | Presentation owner scoped to canvas/run/node | The corresponding visible panel |
| Credential/account/options metadata | Existing query cache with owner/resource keys | Enabled editable dropdown/configuration consumers |
| Execution summaries | Workflow/filter query scope | History list |
| Selected historical graph/results | Selected-run detail owner | Read-only cards/panels for that run |
| Undo/redo and clipboard | Explicit document policy | Document commands, with bounded retention |

### 4.2 Required update matrix

| Event | Components allowed/expected to update | Components that should remain unchanged |
| --- | --- | --- |
| Output for node A | A's open output; open panels/previews explicitly depending on A; A's badge only if displayed status/count changes | Disconnected node card contents, topology-only readers, closed previews, toolbar/history unrelated to this run |
| Status changes for A | A's status/action control; owning cluster aggregate/run control | Other node output views whose values did not change |
| Edit a normal value on B | B's field/configuration and any B summary that actually displays it | Unrelated cards; credential/account requests with unchanged dependency keys |
| Rename/reconnect/type or handle change | Affected graph/index consumers, relevant option inventories, projected endpoints | Unrelated resource queries and runtime payloads |
| Drag a node | Its geometry, incident edge routing, affected frames/occlusion and minimap | Topology-only subscriptions and unrelated field/output content |
| Pan only | Viewport/frame presentation and React Flow's own viewport consumers | Document/configuration/history/palette owners |
| Toast add/dismiss | Toaster UI | Node renaming hooks and document owners that only issue toast commands |
| Same-run unchanged history refresh | List metadata if changed | Selected graph/output references, panel selection, tree/search/scroll |
| Switch workflow/run | New scope initializes intentionally | No prior-scope callback may publish into the new scope |

These requirements concern application content renders, not an unrealistic promise of zero internal React Flow wrapper activity. Measure both separately.

### 4.3 Selector rules

- Use stable `useSyncExternalStore` subscriptions/getters and cached immutable snapshots. Do not return a freshly constructed object from `getSnapshot` on every read.
- A per-node status selector must read only status/control fields, not the full output object. A closed card should not rerender solely because its invisible output payload changed.
- Cache node configuration records by relevant committed values. Preserve identity for unchanged records even when the canonical node wrapper changes for output/position.
- Store node/incident-edge/incoming indexes once per relevant graph revision. Upstream queries should return cached IDs, with value reads performed separately.
- Dynamic Switch handles, tool eligibility, node identity/type, and relevant definition changes must invalidate the appropriate structural view. Position and ordinary result updates must not.
- Keep caches owned by one store/session and bounded to current snapshots. Rename/delete/session change must retire affected keys.
- Preserve stable empty/missing snapshots, and distinguish missing output from present output equal to `undefined` where existing consumers do so.

Proposed APIs such as `subscribeNode`, `getNodeStatusSnapshot`, `getTopologySnapshot`, and `getNodeConfigSnapshot` are design names, not claims that these functions already exist. Adapt names to the existing modules during implementation.

## 5. Work packages

### W00 — Establish rendering, network, and retention baselines

**Priority:** prerequisite for comparative performance claims.  
**Coverage:** all findings, especially F03/F06/F07/F09/F13.  
**Files:** existing test/browser infrastructure; add focused fixtures/instrumentation under the repository's existing test layout.

1. Create deterministic fixtures around the real React Flow/node/edge/panel code, using synthetic outputs and mocked network responses. Include approximately 20, 100, and 300 nodes with realistic edge density; no clusters; collapsed/nested clusters; expanded overlapping frames; Loop/If/OnBar; agent tools; expression-heavy forms; large history/candle payloads.
2. Record three warmed repetitions on the same machine/browser/build, viewport, zoom, fixture, and interaction path. Use production builds for timing and a profiling build/development tooling for render attribution.
3. Measure `WorkflowEditor`, node shell/configuration, Input/Output panels, fields, palette, history, edges, and charts with React Profiler or temporary counters. Record committed renders separately from subscription callbacks, selector checks, render attempts, and mounts.
4. Count topology/configuration/runtime publications, projection/hierarchy evaluations, preview evaluations, series creation/removal, and metadata requests by key. Use aggregate counters rather than logging every output.
5. Capture browser scripting/layout/paint, long tasks, interaction latency, frame intervals, and post-GC retained paths where supported. Count current sockets, reconnect/keepalive timers, action registrations, and observers.
6. Preserve the earlier source-probe cases as focused regression scenarios, but run actual React integration fixtures for rendering assertions.

**Exit:** a reproducible baseline and named performance scenarios. Do not block obvious correctness repairs while waiting for access to a real production account; use controlled fixtures and mark production validation outstanding.

### W01 — Correct execution snapshots and async resource lifetimes

**Priority:** P1.  
**Coverage:** F01, F05, F11.  
**Files:** `WorkflowEditor.tsx`, `workflowExecutor.ts`, `editorNodeExecution.ts`, `ExecutionStoreContext.tsx`, `useWorkflowPersistence.ts`, `useExecutionHistory.ts`; `apiClient.ts` only if a helper signature needs extension.

#### A. Accept one current run snapshot

1. Remove reliance on counts-based `workflowExecutor` memoization for graph freshness.
2. Keep an active executor/controller ref for Stop/unmount cleanup. Construct or explicitly initialize it when a run is accepted, not per canvas render or drag.
3. Capture current canonical nodes/edges/configuration after required save/preparation and current-session validation, under the correct live execution lock. Build node/adjacency/handle/role indexes once for this accepted snapshot.
4. Reuse existing `captureEditorNodeActions` for the executable identities so coordinated execution does not resolve newly replaced action closures midway through a run. Integrate through the existing executor action invocation path; do not create a competing execution engine.
5. Preserve existing current-session/generation checks, variable invocation scope, pinned values, failure outcomes, and terminal publication. Stopping must target the accepted executor even if UI state rerenders.
6. Handle the save-new-workflow case explicitly: if preparation changes workflow/session identity, do not continue using the old lock/actions. Revalidate/reacquire against the settled session or terminate preparation cleanly and continue through one controlled acceptance path. Avoid acquiring overlapping old/new locks or silently dropping the requested run.
7. An accepted run reads one frozen structural snapshot. Runtime outputs and per-action execution contexts continue through existing normal-action semantics.

**Tests:** same-count reconnect, rename, tool-mode/dynamic-handle changes, same-count document restore, saved-new-workflow identity change, cancellation during preparation, error stop, Loop feedback, and second-run freshness.

#### B. Socket setup/reconnect ownership

1. Give each transport effect an effect-local disposed flag/generation, socket, reconnect handle, and keepalive handle.
2. Recheck ownership after awaiting auth and before creating a socket. Every handler verifies that its connection still owns the current generation before publishing or reconnecting.
3. Cancel owned reconnect/keepalive handles, detach obsolete handlers, and close the owned socket during cleanup. An old `onclose` must not clear the new connection's keepalive/ref.
4. Apply a deliberate token/session refresh policy. Do not use a shared boolean as the only lifetime identity.
5. Review both execution-store and editor news/agent sockets. Keep intended event responsibilities; transport consolidation is optional and must not duplicate or lose events.

**Tests:** dispose while auth is pending, rapid effect restart, token/session switch, reconnect during cleanup, and old callbacks after replacement. Expect at most one current socket/keepalive/reconnect per intended transport.

#### C. Scope every load publication

1. Define a scope/generation containing authenticated owner, document/workflow identity, and normalized history filters as relevant. A selected detail also includes run identity.
2. Invalidate all first-page/next-page/detail requests when scope changes. One next-page counter must not survive another scope's first-page reset.
3. Check generation before publishing data, errors, loading flags, selected execution, revision, and dirty/saved hash baseline. A mounted flag alone is insufficient during route reuse.
4. Prefer abortable requests plus generation checks. `apiClient.request` already accepts a `RequestInit.signal`; use it directly or add a backward-compatible helper options parameter. Do not assume the current two-argument `get` helper accepts a signal.
5. Clear or scope selected execution by workflow as well as status/date filters. Late A data must never append into B.

**Tests:** resolve B before delayed A for document load, next-page load, selected detail, and backtest result; assert displayed content and save baseline belong to B.

### W02 — Load credentials/options once per actual resource dependency

**Priority:** P1.  
**Coverage:** F02.  
**Files:** `useNodeCredentials.ts`, `BaseNode.tsx`, configuration/credential select components, auth modal invalidation paths, query helpers as needed.

1. Derive static select options from the manifest instead of copying them into state in field-wide effects.
2. Replace the three overlapping `fieldState` effects with one resource-specific request path. Dependencies are exact scalar parent values and resource identity, not the whole field-state object.
3. Use the existing React Query client for request sharing and lifecycle if appropriate. Credential-list keys include owner and resolved service plus actual server-side filters. Account keys include owner, credential, endpoint/service and any workflow/session/environment dependency the request actually uses. Store workflow/variable keys include their real source workflow scope.
4. Keep tokens/secrets outside keys and cached metadata. Use the latest valid token for requests; owner changes clear/isolate metadata. Handle auth errors through existing flows rather than adding an aggressive retry loop.
5. Accept an explicit `enabled`/editable-configuration signal. Read-only history issues no live credential/account requests. Closed configuration should not fetch data needed only to display options.
6. Preserve execution independence from option display: a node that was never expanded still runs with canonical values, complete schema defaults, required-field checks, and credential IDs.
7. Ignore/cancel late old responses. Prevent one credential's accounts from being shown or accepted for another credential while loading. Preserve a committed value until the existing dependency-validation policy intentionally changes it.
8. Invalidate the relevant metadata after explicit credential create/update/delete; reopening a dropdown must show current data. Choose cache freshness from resource behavior, not an arbitrary token-based key.
9. Share workflow variable snapshot observation at an open configuration boundary where practical. Hidden fields must not activate variable queries solely because they are in expression mode; request when the expression/autocomplete needs variables.

**Acceptance:** unrelated typing produces zero credential/account/Store-option requests; one dependency change produces one request per needed key; concurrent same-key cards deduplicate; read-only requests are zero; late responses cannot overwrite current selection.

### W03 — Introduce narrow graph/runtime views and atomic notification

**Priority:** P1/P2; main rendering foundation.  
**Coverage:** F03, F07.  
**Files:** `canonicalGraphStore.ts`, `StableNodeContext.tsx`, `ExecutionStoreContext.tsx`, `executionContext.ts`, `BaseNode.tsx`, `InputPanel.tsx`, result writers.

#### A. Preserve existing contracts and add views

1. Keep canonical nodes/edges complete and current. Keep legacy full/semantic APIs while their consumers migrate.
2. Add a structure view/index for IDs, endpoints, handle relationships, execution-relevant roles, and upstream IDs. Add per-node editable configuration/identity views and separate geometry/status/output views.
3. Build snapshots with structural sharing: unchanged configuration records/edges retain identity despite unrelated canonical wrapper/output changes. Use explicit field contracts and per-record signatures where current mutation compatibility requires them.
4. Audit/remove direct prop/data mutation such as pin synchronization before depending solely on reference identity. Replace it with canonical commands plus runtime publication; do not freeze existing mutable input objects and hope callers adapt.
5. Maintain nodeById and incident/incoming indexes. Avoid per-card `new Map(nodes)`/full-edge filters, and make `getNodeById` use the shared index where feasible. Preserve node order where UI/default selection requires it.
6. Cache upstream IDs by structural revision. Resolve current values/configuration by ID without retaining historical output objects in the topology cache.

#### B. Notify only subscribers that need the update

1. Add keyed runtime subscription sets with stable cached output/status snapshots and a bounded dirty-node set for the current publication transaction.
2. Keep `setNodeData` as state staging during migration; preserve one explicit notification after a logical accepted result/failure transaction. Do not add auto-notification that doubles existing notifications or exposes partially written state.
3. Provide a backward-compatible notify fallback that flushes staged changed IDs for older callers. Migrate result, listener, Loop, pin, rename, clear/reset, and history-replacement writers systematically.
4. A status consumer gets a status snapshot; an open output gets the output snapshot; selected input gets its selected source; expression previews get their required references. Preserve unchanged snapshot identities.
5. Keep static historical consumers under an isolated subscription provider/hook boundary. They must not read/subscribe to a changing live version context before returning the static value.
6. Imperative consumers use access APIs without subscribing. Remove unnecessary `useExecutionStoreVersion` use from InputPanel/repeater layouts after their dependency selectors exist.
7. Preserve current frame-batched visual progress. Immediate errors, terminal statuses, execution data, and awaited variable commits retain their semantics; presentation coalescing never drops authoritative events.

**Acceptance:** publishing output A causes zero topology-only notifications and no unrelated card-content commits. The legacy canonical output mirror remains correct. One logical result produces one intended explicit notification; static history ignores live messages. Drag-only changes still produce zero semantic notifications.

### W04 — Split React ownership and stabilize actual hot-path props

**Priority:** P2.  
**Coverage:** F06, F09, F15; builds on W03.  
**Files:** `WorkflowEditor.tsx`, `NodeRouter.tsx`, `BaseNode.tsx`, `NodeWrapper.tsx`, layout components, `useNodeFieldState.ts`, `useNodeRenaming.ts`, `use-toast.ts`; small new editor/node modules if useful.

#### A. Editor boundaries

1. Extract small active boundaries for header/run controls, canvas, cluster-frame overlays, history workspace, palette, and dialogs. Migrate the active inline ReactFlow path; the older unreferenced `WorkflowCanvas.tsx` is not automatically the right implementation.
2. Place viewport state/selectors in the canvas/overlay owner. Prefer a viewport portal for frame presentation if it preserves current layering/interactions. Pure pan must not update the main document/configuration/history owner.
3. Resolve hierarchy once per cluster revision and share frame/node indexes. Do not call the hierarchy resolver repeatedly inside sort comparators or once per frame when the same result can be shared.
4. Recompute geometry/occlusion for actual movement/dimension/focus changes. `getExpandedClusterFrameRect` currently ignores its zoom argument; remove unnecessary zoom invalidation only after checking all layout/routing callers. Preserve correct overlap entry/exit during drag.
5. Keep `reconcileClusterProjection` and committed-after-render cache discipline. Cache computation inputs where profiling warrants it; identity reuse alone does not avoid projector work.
6. Keep nodeTypes/edgeTypes/component identities stable across ordinary edits. Read live document data in commands through the existing guarded accessors, not stale callback captures.

#### B. Node boundaries

1. Separate the lightweight card/handles/status from expensive configuration and panel presentation. Keep the existing one-hidden-runtime-host-per-leaf contract during this extraction.
2. Pass per-node summaries and connection selectors to the shell. Avoid copying whole node/edge arrays in the render callback for each card. Named reference inventory belongs to open configuration/preview consumers.
3. Gate selected-upstream/output presentation subscriptions when closed, without removing data required by a real execution action. Execution must resolve its input snapshot imperatively/through the accepted action context.
4. Previously expanded members hidden by a cluster should suspend expensive configuration/chart presentation through explicit render metadata. Do not store this presentation state in the canonical document. Keep action state and execution cancellation intact.
5. Retain current field write timing. Optimize `useNodeFieldState` with equal-value/no-op guards and minimal restore reconciliation; do not introduce blur-only commits or an arbitrary debounce for all fields. Rapid consecutive edits must still build from the latest draft/canonical snapshot.
6. Preserve schema-default backfilling for unopened nodes. If reconciliation later moves to document hydration, retain a fallback for newly inserted nodes and definition/schema changes before disabling the per-node path.
7. Narrow field props to actual value/visibility/dynamic-label dependencies. Compute grouping from stable schema metadata. Memoize expensive leaves only after those props and handlers are stable.
8. Use the exported imperative `toast` command for command-only consumers such as renaming/persistence/activation. Keep subscribed toast state in the toaster UI. Stabilize remaining subscription lifetimes.
9. Memoize provider values/actions where it prevents incidental churn, while still propagating real session/token/theme/timezone changes. Resource effects use scalar identity such as user ID, not a refreshed whole-user object.

**Memoization rules:** existing `memo(NodeRouter)` does not suppress child-hook/context updates. Avoid deep graph/output comparators; do not ignore configuration, IDs, callback semantics, or pins in custom comparisons. No blanket `useMemo`/`useCallback` addition.

**Acceptance:** pure pan leaves header/history/forms idle; output updates leave disconnected card contents idle; toast lifecycle does not rerender every BaseNode; normal typing preserves caret and current values. Execute unopened/hidden members, expand/collapse clusters, and restore nodes without losing actions/defaults.

### W05 — Make previews and output display demand-driven

**Priority:** P2.  
**Coverage:** F07, F08.  
**Files:** `NodeFieldRenderer.tsx`, `useFieldPreview.tsx`, `useNodeReferences.ts`, `previewDataResolver.ts`, `RepeaterNodeLayout.tsx`, `useNodeOutput.ts`, `OutputPanel.tsx`, `InputPanel.tsx`.

1. Separate preview open/anchor state from preview content calculation. A generic preview must not call its evaluator merely to discover whether a popup might be available.
2. Gate evaluation by field visibility, panel visibility, preview interaction, expression mode/value, and read-only/live scope. Keep hooks unconditional; use enabled flags or component boundaries rather than conditional hook calls.
3. Reuse the typed Edit Fields open-state + 250 ms typing debounce pattern where appropriate. Opening can evaluate immediately; typing can debounce. Ignore superseded generations and clean up timers on close/restore/session switch.
4. Build one preview context per relevant open configuration snapshot, rather than rebuilding all-node output maps per field during render. Preserve the complete identity inventory, but subscribe to explicit output references. Use a scoped fallback for dynamic/unresolvable dependencies; do not invent guessed edges from references.
5. Add bounded formatted-result characters/depth/entries. Keep existing array summarization and parser/expression budgets. Large display output is separate from full execution output.
6. Derive ordinary displayed output from current authoritative output and pin state. Keep local state only for a real edit draft, unsaved override, or defined presentation state. Remove redundant effect-driven mirrors incrementally.
7. Define pin precedence consistently for store/canonical/history; restore an externally changed pin without preserving an old `overrideOutput` accidentally. Preserve explicit falsy/null outputs and missing-output ownership checks.
8. Preserve an intentional active edit draft when streaming data arrives, with a defined existing save/cancel policy. A genuine run/node switch resets the draft; an unrelated parent render does not.
9. Keep input dropdown repair against the correct live/history upstream inventory. An unavailable historical branch never falls back to live/pinned data. Historical timestamps remain historical.

**Acceptance:** closed/hidden generic previews perform zero evaluations; open previews reflect only relevant updates; unchanged refresh preserves selection/search/scroll; pin/edit/unpin/restore behave correctly for null, false, zero, empty string, and missing data.

### W06 — Dispose sessions and bound retained document/runtime data

**Priority:** P1/P2.  
**Coverage:** F04, part of F09.  
**Files:** `WorkflowEditor.tsx`, `executionContext.ts`, `editorNodeExecution.ts`, `useNodeOutput.ts`, run/listener cleanup paths, document history helpers.

1. Define distinct operations for Clear Runtime (existing user behavior preserving current pins), retire node identity, replace document session, and final dispose. Do not reuse `clear()` as a full session reset when it retains pins.
2. On session replacement, invalidate old callbacks/loads first, stop/abort old editor-local controllers/listeners, prevent old publication, clear old action/activity/aggregation/preview caches, and initialize the new runtime under its own scope.
3. Preserve ownership order: do not destroy a controller/store while accepted work can still publish through it. Frontend disposal must not automatically deactivate an independent server live strategy or change server trading/variable drain policy.
4. Reset undo/redo on true document identity changes. Route/session reuse with overlapping node IDs must not reuse old outputs, pins, local errors, or drafts.
5. Prune deleted runtime IDs, pending dirty IDs, action registrations, pin entries, and per-node caches through the canonical retirement command. Hidden members are not deleted members. Rename remains one coordinated identity transaction, including undo/redo.
6. Bound undo/redo by an explicit count policy (start with a configurable 100-entry default and validate with workloads). Release evicted snapshots promptly. Preserve current position-only history entries. Track approximate retained data outside frame-critical code; do not stringify the full graph per keystroke for a memory estimate.
7. Separate editable undo snapshots from runtime-only payloads where current undo semantics allow it. Explicit pinned outputs remain document data. Document and test any policy for restoring runtime results after undo; never mutate old published snapshots or silently truncate pinned output.
8. Preserve intentional cross-workflow clipboard support, but retain a bounded detached representation and the identity/alias inventory required by existing remapping. Remove callbacks/projected flags/unnecessary runtime payloads only after auditing clipboard readers. Do not flatten nested cluster ownership.
9. Previously captured closures may outlive a rendered component by design; ensure retirement/session disposal bounds their lifetime. A frozen display card is not a disposal mechanism.

**Acceptance:** A → B navigation plus Undo cannot restore A into B; deleted IDs do not retain outputs indefinitely after history eviction; repeated add/run/delete/navigation cycles reach a stable baseline. Valid undo/redo/pins/cross-workflow paste still work.

### W07 — Load execution summaries separately and stabilize selected detail

**Priority:** P2.  
**Coverage:** F10, F11.  
**Files:** `useExecutionHistory.ts`, `WorkflowEditor.tsx`, `ExecutionHistoryPanel.tsx`, `ExecutionDetailView.tsx`, `StaticExecutionStoreContext.tsx`, relevant history types/adapters.

1. Introduce explicit summary/detail types. List queries select only fields needed by the row/filter/status UI; full graph/results are fetched for the selected run. Keep restore/copy-to-editor available after fetching required detail.
2. Own summary pagination by workflow/filter scope and stable cursor/order. If bounding retained summary pages, keep the pagination cursor independent of retained `executions.length`; eviction must not skip or repeat pages.
3. Keep a small selected-detail cache, initially the selected run plus at most two recent details, scoped to owner/workflow. Evict by policy; do not retain full outputs for every list row.
4. Gate initial heavy history work by active history view. If the editor needs a lightweight execution status signal, keep that separately. Pause unnecessary hidden-document polling. Preserve the user's auto-refresh choice and actual active-run updates.
5. Fetch and normalize selected graph/results once, sharing historical node identity, output, upstream, and execution maps across cards. Do not rebuild an all-executions map and whole historical reference inventory inside every BaseNode.
6. Replace the budget-overflow identity fallback with a documented strategy that does not repeatedly publish identical large completed results. Prefer an existing trustworthy revision/ETag; first verify the actual API fields. Do not assume such a field exists, and do not assume status/ID/completed time alone proves immutable content.
7. If no revision exists, keep selected detail separate from periodic summary refresh. Refresh terminal detail only on relevant invalidation/manual refresh/selection. For an actual detail refresh, compare/normalize within the existing bounded-work policy and retain identities where equality is established; content digest work, if needed, runs once off the interaction path. Active-run changes must always propagate.
8. Realtime summaries must not overwrite complete selected detail with a partial payload. Invalidate/refetch the selected detail for relevant events with single-flight/generation control. The existing database-change transport may still send a full row: narrowing a list query does not narrow that event payload. Avoid retaining unused event bodies; if their network/parse cost remains material, propose a separate bounded invalidation/summary transport rather than claiming a frontend selector removes those bytes.
9. Atomically replace a genuinely changed static snapshot and notify once. Preserve `ReactFlowProvider` keyed by run ID; never key by refresh time, payload object, or poll counter.
10. Keep current saved-topology upstream selection, historical missing-output states, same-run expanded panels, and truthful timestamps. History remains isolated from current editor results and live version context.

**Acceptance:** repeated unchanged large-run refresh leaves selected graph references and panels stable; 10+ list pages do not retain 10+ pages of large outputs; selected running-run changes arrive; scope changes cannot append old pages; history Copy/Restore uses the correct complete detail.

### W08 — Bound JSON presentation and search

**Priority:** P2.  
**Coverage:** F12.  
**Files:** `DraggableFieldsPanel.tsx`, `InputPanel.tsx`, `OutputPanel.tsx`, `VirtualizedArrayBrowser.tsx` only if connected deliberately.

1. Add a lazy expansion tree with one global visible-entry/depth/character budget, rather than only 25 items per nested array. Establish initial budgets in W00; a reasonable fixture starting point is 200 rendered entries, with explicit expansion/paging for more.
2. Keep reference paths stable for nested objects/arrays and `$vars`. Bounded display must not alter source data, index meaning, drag payloads, or exported output.
3. Provide a virtualized/paged large-array view through the active panels. The existing browser currently has no imports; connecting it requires tests, not only retaining the file.
4. If reused, calculate matching original indexes once per search query; avoid stringifying every item twice per keystroke. Debounce/defer search and use a worker only if measured size warrants it.
5. Bound long-string display; permit deliberate inspection/export. Avoid full JSON serialization just to determine the edit panel is over its limit. Use payload metadata or a bounded traversal for edit eligibility.
6. Keep full export an explicit potentially large operation. Revoke object URLs and clean up work on close/scope change.

**Acceptance:** wide objects, nested 25×25 arrays, deep structures, and huge strings keep bounded DOM/work. Full result/export and precise reference drag remain correct.

### W09 — Update charts incrementally and optimize long Loop aggregation safely

**Priority:** P2, measured large-data work.  
**Coverage:** F13, F14.  
**Files:** `VisualizeNodePreview.tsx`, `LightweightVisualizeChart.tsx`, `lightweightSeriesBuilder.ts`, `RepeaterNodeLayout.tsx`, `executionContext.ts`, Loop consumers.

#### A. Charts

1. Stabilize the chart view model against relevant series/overlay changes, not every global execution version.
2. Retain series by overlay ID/type. Separate theme/options reconciliation from data reconciliation; reuse existing observers and cleanup.
3. Use append/current-point update for compatible ordered stream changes. Use full replacement for backfills, corrections outside the latest point, reorder/truncation, new run/symbol/timeframe, or incompatible overlay changes.
4. Fit initially or on explicit auto-follow policy; preserve a user-selected range when new unrelated/compatible data arrives.
5. Keep complete authoritative data; downsample only plotted representations if needed, with correct OHLC/indicator semantics.

**Acceptance:** append/current-candle updates do not recreate all overlays; historical replacements remain correct; range, legends, pane sync, observer cleanup, and light/dark changes work.

#### B. Loop aggregation

1. Benchmark repeated `prevAgg.concat` on realistic long loops; record allocation/time versus item count separately from rendering.
2. Audit all in-progress `aggregated`/return readers before changing storage. Current public arrays and previous outputs cannot become mutable shared buffers.
3. Use private execution-owned chunks/buffers with immutable materialization at required read/publication boundaries, or another representation that reduces repeated copying while preserving public array contracts.
4. A reader needing a complete prefix still incurs materialization cost. Do not claim linear aggregate cost if an immutable full prefix is required every iteration. Retain the existing representation until those read semantics can be preserved with a measured benefit.
5. Preserve every final result, ordering, batch/feedback semantics, scope, cancellation, and pins. Only presentation can use a bounded progress snapshot.

**Acceptance:** final outputs match existing behavior exactly; no mutation of previously observed prefixes; measured cumulative copying/allocations improve for the supported long-loop case.

### W10 — Reduce startup and high-frequency diagnostic work

**Priority:** P2.  
**Coverage:** F16, F17.  
**Files:** `App.tsx`, `Interface.tsx`, node/configuration imports, `ExecutionStoreContext.tsx`, `useNodeCredentials.ts`; Vite configuration only when measurements justify it.

1. Move page routes to module-scope lazy imports with localized Suspense/error boundaries. Preserve direct navigation and route auth checks.
2. Split heavy configuration/history/chart presentation after W04 separates its runtime duties. Unopened nodes must still have synchronous identity/definition data needed by execution and palette.
3. Keep the eager manifest metadata if it is cheap/required; measure its real contribution before async definition loading or per-icon chunking. Avoid speculative manual chunk rules.
4. Gate full payload diagnostic logs behind opt-in development/debug controls. Use bounded counters/timings and safe IDs for production diagnostics; preserve meaningful errors.
5. Reuse existing finite icon caches; only add in-flight icon-load deduplication if a mount trace shows repeated decode/request work. Do not call a manifest-bounded image cache an unbounded leak.

**Acceptance:** dashboard/login visits do not load editor/chart presentation chunks unnecessarily; direct editor routes and first expansion work; production stream handling does not log full event/credential payloads by default. Record actual compressed bytes and parse/evaluation time.

### W11 — Bound supporting-page data work

**Priority:** P2 after core editor milestones.  
**Coverage:** F18.  
**Files:** live/backtest hooks, `Dashboard.tsx`, `Projects.tsx`, `Workflows.tsx`, orders/trades tables and equity presentation.

1. Use summary queries for workflow/project/list pages; avoid fetching graph/output bodies solely to display row counts/status. Batch project counts and latest-run summaries where supported.
2. Coalesce realtime invalidations and allow one current load per owner/workflow/session. Merge authoritative deltas by ID where correct; reconcile gaps/session switches/backfills with scoped loads.
3. Paginate trades/fills/snapshots and virtualize large tables. Keep full export available through a separate bounded fetch/stream path instead of relying on all rows being mounted/cached.
4. Avoid full-history sorting/normalization/metrics calculation per new snapshot when correct incremental updates exist. Some risk/return metrics need historical recomputation; retain mathematical correctness and defer/batch that work appropriately.
5. Eliminate one-request-per-project/workflow patterns using existing query capabilities or a separately reviewed summary endpoint. Do not change database/RLS/schema as incidental frontend cleanup.

**Acceptance:** event bursts do not trigger parallel full reloads; late old responses cannot replace current sessions; metrics/table/export agree; network and DOM costs stay bounded for long sessions.

### W12 — Consolidate inactive source paths after active fixes

**Priority:** P3.  
**Coverage:** F19.  
**Files:** unreferenced `WorkflowCanvas.tsx`, `useWorkflowExecution.ts`, `WorkflowHeader.tsx`, `NodeExecutionInspector.tsx`, and any superseded helpers.

1. Recheck imports, dynamic usages, external exports, and tests at implementation time.
2. Remove or intentionally integrate redundant implementations after the active code is stable. Do not optimize an unused component and count it as an active editor improvement.
3. Update architecture notes to identify the active canvas, run controller, state owners, and selector contracts. If an architecture rule changes, update `AGENTS.md` in the same reviewed change rather than silently diverging.

**Acceptance:** one documented active path; no broken imports/tests; no runtime speedup claimed solely from deleting already tree-shaken code.

## 6. Ordered implementation slices and dependencies

| Slice | Scope | Depends on | Reviewable result |
| --- | --- | --- | --- |
| PR-01 | W00 fixture/counters plus narrow F01 regression | Baseline | Repeatable probes and actual React fixture; no behavior refactor |
| PR-02 | W01 run snapshot/action capture | PR-01 | Same-count graph edits execute correctly; Stop targets current run |
| PR-03 | W01 socket and request-generation lifetimes | PR-01 | Disposed/old work cannot publish; no late socket ownership |
| PR-04 | W02 resource-keyed option loading | PR-01; scope utilities from PR-03 if shared | Zero unrelated refetches; read-only metadata requests disabled |
| PR-05 | W03 graph views/indexes and selector tests | PR-02/03 | Additive narrow graph APIs with legacy contracts intact |
| PR-06 | W03 runtime notifications and W05 source/output subscriptions | PR-05 | Result publication stays atomic; unrelated consumers remain idle |
| PR-07 | W04 canvas/node composition and toast commands | PR-05/06 | Viewport and card/configuration ownership isolated |
| PR-08 | W05 preview demand and field/output state simplification | PR-06/07 | Closed previews idle; pin/edit/restore behavior verified |
| PR-09 | W06 session retention/undo/clipboard | PR-03/06; coordinate with PR-07 | Bounded/disposed old state; document undo isolation |
| PR-10 | W07 selected-detail history and W08 JSON display | PR-03/06/08 | Stable large history; bounded viewer/list payloads |
| PR-11 | W09 chart update strategy | PR-07/08/10 | Retained series and correct incremental updates |
| PR-12 | W09 Loop representation, only if audit permits | PR-02/06; long-loop baseline | Equivalent immutable outputs with measured allocation improvement |
| PR-13 | W10 route/configuration loading and diagnostics | PR-07; log gating can land earlier | Measured startup reduction and bounded diagnostics |
| PR-14 | W11/W12 supporting data and source consolidation | Core milestones complete | Bounded surrounding pages and one documented active path |

This is an ordering proposal, not a requirement to open 14 PRs simultaneously. Keep changes sequential and scoped; merge a slice once its tests and measurements pass. Combine small adjacent slices only when the review remains clear. Do not delegate/parallelize repository edits without an explicit instruction to do so.

## 7. Component-by-component change checklist

| Component/hook | Required action | Preserve |
| --- | --- | --- |
| WorkflowEditor | Extract viewport/history/UI owners; accept current run; scope loaders; bound history | Canonical commands, mutation guards, save/activate behavior |
| BaseNode | Replace whole semantic inventory consumption with own config/status + requested source views | Default hydration and normal-action availability |
| NodeRouter | Stop graph-array copying in render; stabilize meaningful props | Node definitions, tool/handle changes, agent status |
| NodeWrapper | Keep shell local; mount visible configuration/panels intentionally | Handle geometry, expansion, portal, pin controls |
| BasicNodeLayout | Stable schema grouping and dependency-specific field props | Field visibility/defaults, credential/auth controls |
| RepeaterNodeLayout | Narrow runtime/reference subscriptions; share preview context | If/Switch/Edit Fields/Visualize semantics, typed preview debounce |
| NodeFieldRenderer | Demand-driven generic preview and query gating | Hook order, caret/drop behavior, dynamic labels/value modes |
| useNodeFieldState | No-op guards and minimal restore reconciliation | Immediate canonical values and synchronous draft composition |
| useNodeCredentials | One keyed request path; static options derived | Correct service/account/Store dependency behavior |
| useNodeOutput / OutputPanel | Derive display; local draft only; synchronize real pin restore | Output precedence and edit/pin/save semantics |
| InputPanel | Selected-source subscription; correct static boundary | Upstream selection, missing/falsy data, variables tab |
| useNodeReferences / preview helpers | Cache requested context and evaluate only on demand | Complete identity lookup and bounded evaluator |
| ExecutionStore providers | Keyed subscriptions, cached slices, lifecycle-safe sockets | Explicit result publication and static isolation |
| canonicalGraphStore / StableNodeContext | Additive topology/config/geometry views and indexes | Full/legacy semantic behavior until migration |
| EdgeManager / hover hooks | Regression gate; avoid broader subscriptions | Existing endpoint-only routing and leave delay |
| Cluster projection / frame helpers | Share hierarchy/indexes and isolate transforms | Committed identity reuse, mapping, visibility, hidden runtime hosts |
| ExecutionDetailView / static store | One normalized detail owner and atomic replacement | Run-key isolation, saved topology, same-run panel state |
| ExecutionHistoryPanel | Summary rows and stable pagination cursor | Existing virtualization/filter UX |
| DraggableFieldsPanel | Lazy bounded tree with accurate references | Full underlying data and drag paths |
| Visualize preview / chart | Stable source inputs and retained series | Corrections/backfills, legends/ranges/cleanup |
| useNodeRenaming / toast consumers | Imperative toast for command-only use | Rename transactions and focus/error feedback |
| Interface / App | Route lazy boundaries | Auth routes and direct linking |
| Other routes and UI primitives | Fix through measured owning data flows | Existing visual/accessibility contracts; no blanket memo changes |

## 8. Tests and acceptance

### 8.1 Focused correctness tests

- Run snapshot: reconnect/rename/restore/tool mode/dynamic handles with unchanged counts; captures current action scope and stops on error.
- Lifetime: deferred auth/load after cleanup, old user/workflow/filter responses, new-workflow save identity, reconnect ownership, Stop during preparation.
- Publication: accepted success/error/pin/clear/rename updates the required destinations once; stale generations publish nowhere; no partially observable result.
- Store identity: position-only semantic regression; output-only topology regression; unchanged per-node config/status identity; legacy semantic compatibility including supported mutation cases.
- Requests: exact dependency keys, concurrent deduplication, static options, auth owner changes, explicit credential invalidation, A/B response race, read-only gating.
- State restoration: field/pin undo/redo/session switch with shared node IDs; null/false/zero/empty/missing values remain distinct.
- Cluster/manual: unopened and hidden members, nested parent execution, Loop repetitions, cancellation, rename, save/load/export, copy/paste ownership.
- History: unrelated live activity, three or more refresh cycles, unchanged large terminal result, actual running update, unexecuted branch, run switch, bounded detail eviction, pagination after eviction.
- Preview/viewer: closed/hidden evaluation counts, typed/generic expression parity, computed slices, variables, reference drops/caret/selection, bounded DOM and full export.
- Chart/Loop: append/correct/backfill/reset/run switch, stable series/range; immutable aggregate prefixes and exact final outputs.

Use actual React Flow/component-mounted integration tests for render/selection/lifecycle behavior, not only pure selector tests or source-text checks. Use mocked data/services rather than real orders or credentials.

### 8.2 Performance and resource gates

| Gate | Requirement |
| --- | --- |
| Unrelated field edit | Zero option requests and zero closed-preview evaluations |
| Output A | Zero topology-only notifications; unrelated card content has no update-attributable commit |
| Geometry-only move | Zero semantic/configuration publications except genuinely changed geometric views |
| Pure pan | Header/history/form owners remain idle; current frame placement correct |
| Static history + live events | No live-version-triggered history content commits |
| Same-run refresh | Selection/tree/search/scroll/viewport preserved unless actual corresponding content changed |
| Session disposal | No owned sockets/timers/listeners/actions remain live or able to publish |
| Long navigation/edit cycles | Retained paths stabilize within documented history/cache policies |
| Large viewer/table | Rendered entries stay within the chosen budget; full authoritative data remains available |
| Chart stream | No full series recreation for compatible append/current-point updates |
| Long Loop | Better measured allocation/time curve where reader contracts allow it; identical outputs |

After W00, use representative medium-fixture targets of approximately 20 ms p95 frame intervals during the specified drag/pan scenarios, no repeated attributable tasks over 50 ms, and responsive input around 100 ms or better on the documented test machine. These are proposed acceptance targets, not current measured results or device-independent guarantees. Report median/p95 over the same warmed repetitions and explain workload/hardware exceptions.

Measure retained browser heap after controlled repeated cycles and GC when available. Do not equate process RSS or a large legitimate pinned/output dataset with a leak. Separate current document data, bounded undo/detail/query cache, retained closures, detached DOM, and active resources. Compare with verbose logging controlled and console retention accounted for.

### 8.3 Repository checks

Run the focused existing semantic/input/cluster/identity/pin/execution tests plus new targeted cases for changed behavior. Run the configured type check, changed-file lint, node validation, production build, relevant Playwright scenarios, and `git diff --check` using the repository's actual tooling. Record existing unrelated failures separately. This planning change does not claim implementation tests passed.

## 9. Rollout and rollback

1. Land additive selectors first and migrate one consumer family at a time; keep a temporary compatibility path only where needed.
2. Preserve legacy canonical output publication throughout the core implementation. Removing it requires a separate architecture-contract change and a complete reader audit.
3. Verify the same deterministic scenarios after every major slice. Reprofile before adding more speculative optimization.
4. Keep rollback scoped by PR: return migrated consumers to the compatible API or revert that slice, without changing saved document/output formats.
5. Any temporary profiling switch should be development-only and removed or documented after comparison. Do not introduce a permanent flag for every small optimization.
6. Stop expanding scope when the stated scenario passes and profiling no longer identifies the proposed follow-up as material. Supporting pages and paint effects must not delay core correctness/rendering fixes.

## 10. Finding coverage

| Review finding | Implementation owner |
| --- | --- |
| F01 stale executor graph | W01-A |
| F02 credential/options refetch | W02 |
| F03 whole semantic invalidation | W03, W04 |
| F04 retained session/history/runtime data | W06; lifetime checks W01 |
| F05 socket cleanup race | W01-B |
| F06 viewport/root/hierarchy work | W04-A |
| F07 broad runtime version and output mirrors | W03-B, W05 |
| F08 eager generic previews | W05 |
| F09 closed/hidden node ownership | W02, W04-B, W06 |
| F10 history payload and identity | W07 |
| F11 async scope races | W01-C, W07, W11 |
| F12 recursive JSON/search work | W08 |
| F13 full chart reconciliation | W09-A |
| F14 growing Loop array copies | W09-B |
| F15 command-only toast subscriptions | W04-B |
| F16 hot-path logs | W10 |
| F17 eager routes/configuration | W10 |
| F18 supporting-page data amplification | W11 |
| F19 inactive duplicate implementations | W12 |

## 11. Completion checklist

- [ ] Current run graph/actions are correct after same-count edits and save preparation.
- [ ] Old async work cannot publish after document/session/filter replacement.
- [ ] Metadata queries use exact dependencies and do not load for history/closed display unnecessarily.
- [ ] Runtime result publication preserves required canonical/local/store behavior with scoped notification.
- [ ] Topology, per-node configuration, status, output, and geometry subscriptions are separated and cached correctly.
- [ ] Canvas movement no longer drives unrelated editor/form/history rendering.
- [ ] Closed generic previews are idle; visible previews remain semantically correct.
- [ ] Output drafts/pins/restores and history input selection remain stable.
- [ ] Hidden members and unopened nodes execute through the existing normal-action contracts.
- [ ] Undo/clipboard/runtime/detail caches have explicit bounded lifetimes.
- [ ] Large JSON, charts, loops, and supporting tables pass their workload-specific gates.
- [ ] Production loading/logging work is reduced based on measured evidence.
- [ ] Existing optimized edge/projection/visual batching behavior remains intact.
- [ ] Before/after metrics, test results, limitations, and changed state owners are documented.

Core delivery is W00–W08 plus measured chart/loop work where relevant. Startup/supporting-page cleanup can follow as separate slices. No frontend speedup percentage or memory-saving amount is promised before those measurements.
