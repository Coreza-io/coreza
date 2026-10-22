# Broker authentication errors and execution-history input-panel stability
Date: 2026-10-22
Target: Coreza-io/coreza, dev only
Status: implementation plan only; no runtime implementation in this commit.

## Goals
1. Replace vague broker authentication failures with actionable messages in node output and the execution-history error banner.
2. Keep an open historical input panel stable while live activity and history auto-refresh continue.
3. Make the smallest changes that address the verified causes. Preserve existing execution, credential caching, graph and output contracts.

## Evidence and diagnosis

### A. Authentication message loses context
The user confirmed that selecting the wrong credential caused the Alpaca 401, and that correcting the selection resolved authentication. Do not describe this as an executor-routing failure.

Verified dev sources:
- coreza-backend/src/nodes/executors/BrokerExecutor.ts: credentials are loaded and auth headers built before sending the external request. Its catch block extracts response.data and eventually passes its message to createErrorOutput. An Alpaca response whose message is "unauthorized." therefore becomes exactly that text.
- coreza-backend/src/brokers/alpaca/http/config.ts: account/trading requests go to live only when resolved input.environment === "live"; otherwise they go to paper. Auth headers come from client_json.api_key and client_json.secret_key.
- coreza-backend/src/utils/brokerAuthError.ts: current typed auth errors cover OAuth reconnect/refresh, not generic API-key authentication.
- coreza-backend/src/utils/normalizeOutput.ts: createErrorOutput supports details, but toNodeResult returns only success/data/error/meta; details are dropped. The non-standard normalizeOutput branch also retains only a limited subset of metadata.
- coreza-backend/src/services/WorkflowRunner.ts: the failed engine result's error.message is used for the recorded run error.
- src/components/workflow/ExecutionDetailView.tsx displays execution.error_message directly; improving only the frontend banner would leave other consumers with the vague error.
- src/utils/persistedNodeResult.ts already preserves details from a legacy envelope when supplied.

The screenshots show the bare message in both the run banner and output panel. They also show "My Alpaca2" and paper mode on the inspected node. A broker 401 alone cannot prove that the user picked the wrong saved entry rather than providing invalid keys or using the wrong environment.

### B. Historical selection has two conflicting owners
Verified sources:
- src/components/nodes/BaseNode.tsx owns selectedPrevNodeId. It always computes previousNodes from useSemanticGraphSnapshot() and runs a selection-repair effect with no readOnly guard.
- src/contexts/StableNodeContext.tsx creates a separate canonical graph store; semantic snapshots do not fall back to React Flow nodes. They require explicit publication through useCanonicalGraphSync/setCanonicalDocument.
- src/components/workflow/ExecutionDetailView.tsx mounts an isolated StableNodeProvider but does not publish a canonical historical document into it.
- Consequently BaseNode sees no semantic ancestors in this view and resolves a selection to the empty string.
- src/utils/InputPanel.tsx has a separate readOnly effect: whenever selection is empty, it selects allNodeExecutions[0].nodeId.
- These effects write the same selection in opposite directions: executed node -> empty -> executed node. This is a concrete code-level cause consistent with the screenshots alternating between AlpacaStreamListener data and "Select node...".

Additional verified refresh amplification:
- WorkflowEditor passes getNodeExecutions(selectedExecution) inline, constructing a new array on each parent render.
- ExecutionDetailView passes nodeExecutions.map(...) inline to StaticExecutionStoreProvider.
- StaticExecutionStoreProvider clears and repopulates its store and increments version whenever that array identity changes.
- useExecutionHistory polls every five seconds with auto-refresh enabled and replaces the selected execution with the newly fetched object even if its persisted content is unchanged.
- InputPanel renders the current wall-clock time on every render, so its changing timestamp is not evidence of new historical data.

These amplify rerenders but must not be confused with the direct selection feedback loop. Runtime reproduction/profiling is still required to measure the effect after the targeted repair.

## Plan A: actionable broker errors

### 1. Normalize authentication at the broker boundary
Add a small broker error formatter/helper next to the existing auth-error utilities, or extend the existing utility with a narrowly scoped API-key 401 mapping. Keep formatting out of individual account/position operation definitions.

Capture safe request context in BrokerExecutor so the catch block can use it:
- broker/provider;
- node identity and display name, with existing fallbacks;
- operation;
- saved credential display label, using the actual resolved record's supported fields (inspect CredentialManager's return type before choosing a field);
- actual resolved request environment/host when known.

Only classify an actual broker HTTP 401 as an API-key authentication rejection. Preserve existing OAuth reconnect and refresh-specific messages/codes. Do not classify all Axios ERR_BAD_REQUEST errors as auth errors; that code covers other 4xx failures. Keep 403 permissions/subscription failures, 429 limits, network failures and broker business errors distinct.

Proposed message, using the credential label available for this run:
> Alpaca authentication failed (401) in node "getBrokerBalance" while getting account details. Selected credential: "My Alpaca2". Environment: Paper Trading. Check that this is the intended credential and that its API key and secret are valid for Paper Trading.

For another broker or operation, derive context from existing broker/operation definitions or use its safe identifier; avoid hardcoding every operation. If environment or credential label is unavailable, omit it rather than guessing.

The message should advise checking the selection and matching paper/live keys; it must not assert that a mismatched environment or wrong credential is proven by a 401. Do not automatically switch credentials/environments, regenerate keys, or retry against live.

### 2. Preserve the existing output envelope
Keep error as a readable string and success:false. Use optional allowlisted structured details if useful:
- code: BROKER_AUTHENTICATION_FAILED
- httpStatus: 401
- provider, operation, nodeId, credential label, environment
- action: CHECK_CREDENTIAL_AND_ENVIRONMENT

Before adding fields, inspect frontend/backend node result and node output types and the engine's normalization/persistence path. Ensure approved details survive createErrorOutput -> toNodeResult -> engine nodeResults -> stored execution -> normalizePersistedNodeResult. Make the smallest compatible type/adapter updates needed, without changing unrelated output shapes. If the readable error string is sufficient for the first patch, do not expand every normalization path merely to add optional metadata.

Never pass through full Axios configs, headers, credentials.client_json, API keys, secrets, authorization tokens, or unfiltered response bodies. Retain safeToolError for logs; add only approved non-secret diagnostic context.

### 3. Verify all surfaces receive the same message
Trace the actual engine failure aggregation used by WorkflowRunner and manual/agent execution. Preserve the enriched string when producing the top-level run error; do not overwrite it with the broker's original "unauthorized." or a generic workflow error.
- Node Output Data: actionable error.
- Execution banner: same context, optionally prefixed by failed node name.
- Agent tool observation/manual failure: same normalized broker error through their existing paths.
- Multiple failed nodes: retain each node's error; the run banner may show the first failure using the existing failure-selection policy.

Existing historical records with only "unauthorized." remain readable. Do not backfill them with today's credential selection, which could misrepresent the original failure.

## Plan B: stable historical input inspection

### 1. Remove the selection feedback loop first
In BaseNode's editor topology selection-repair effect, return immediately for readOnly views. Include readOnly in effect dependencies. Audit any other writers of this same selection for the same mode boundary.

History selection should be owned by one policy against allNodeExecutions, not repaired against the live/editor semantic graph:
- retain the user's selection while that node remains in the selected run's executed-node options;
- when no valid selection exists, derive a default from that run's executed nodes;
- retain the existing first-executed default for this minimal fix;
- when no executed nodes exist, show an explicit empty state;
- repair only when the selected run/node changes or a selected option actually disappears;
- never enter live resolveLiveInputData as a readOnly fallback when historical data is absent.

Prefer one shared pure history-selection resolver and a single guarded synchronization effect if needed. Derive a valid selected ID synchronously for rendering so opening the panel does not require a blank initial frame. Preserve property-based output precedence for null, false, zero, empty string, and missing output.

Do not publish projected history nodes into the live canonical store as a workaround. History stays isolated. Only introduce an isolated historical canonical graph sync if another verified history feature needs topology, using unprojected snapshot nodes/edges and a run-scoped identity; it is not required to fix this selection conflict.

### 2. Stabilize selected-run data
Memoize getNodeExecutions(selectedExecution) in WorkflowEditor, keyed to the selected execution's relevant persisted inputs. Memoize the mapped static-store payload in ExecutionDetailView.

In useExecutionHistory, preserve the selected execution reference when a refreshed record has no relevant changes. Use an existing revision signal if present; otherwise compare the specific persisted fields needed by the detail view with a bounded, documented strategy. Do not assume unchanged status alone means unchanged results: a selected running/pending run must still receive genuine result/status/snapshot changes.

Sidebar insertions and unrelated run updates must not change the selected run or reset its panel. Avoid a broad expensive JSON serialization on every live tick just to suppress rerenders. Keep refresh enabled and working.

### 3. Avoid redundant static-store reset
StaticExecutionStoreProvider should update only for a genuinely changed selected-run payload. Keep a stable context value/callback where practical and do not clear/repopulate on unrelated parent renders. Batch replacement and notify once if the store API allows it; avoid partial observable snapshots.

Keep ReactFlowProvider keyed by execution.id: resetting when switching runs is intentional. Do not key nodes/panels by poll time, current Date, result object identity or refresh counter.

Preserve expanded node, previous-node selection, search, tree expansion, and scroll on same-run background refresh. Inspect src/utils/DraggableFieldsPanel.tsx only if those states still reset after the main repairs; avoid changing it speculatively.

### 4. Make timestamp truthful
For readOnly input panels, pass an existing historical timestamp from the selected run/node execution and display it using userTimezone. If unavailable, omit it or show an explicit unavailable value. Do not render new Date() as if history input had just updated. Keep live-mode behavior separate.

### 5. Keep existing history semantics
The current history adapter sets node input to null and the dropdown displays selected executed-node outputs. This patch must not invent exact per-invocation inputs, start persisting all streaming inputs, or change the meaning of existing recorded outputs. Preserve the current dropdown options; changing to ancestor-only options is a separate product decision.

## Proposed files
Required or likely:
- coreza-backend/src/nodes/executors/BrokerExecutor.ts
- coreza-backend/src/utils/brokerAuthError.ts or a small adjacent broker error helper
- src/components/nodes/BaseNode.tsx
- src/utils/InputPanel.tsx
- src/pages/WorkflowEditor.tsx
- src/components/workflow/ExecutionDetailView.tsx
- src/contexts/StaticExecutionStoreContext.tsx
- src/hooks/useExecutionHistory.ts

Conditional, only if structured details are included or message propagation tests expose loss:
- coreza-backend/src/utils/normalizeOutput.ts and relevant node result/output types
- engine aggregation/manual/agent adapters identified during implementation
- frontend node output types and src/utils/persistedNodeResult.ts
- NodeWrapper/NodeRouter prop types for the historical timestamp.

No database schema migration or credential-cache redesign is needed for the proposed fixes. Follow root AGENTS.md: isolated history, canonical graph boundaries and existing guarded output publication remain authoritative.

## Verification and acceptance

### Authentication tests
- Mock an Alpaca account 401 for the wrong saved credential: assert provider, node, credential label, operation, paper/live context and remediation survive to node output and run error.
- Cover positions as well as account without separate operation-specific formatting code.
- Correct credential mocked success is unchanged.
- Missing context produces a clean message without undefined values.
- 403, 429, 422, network errors and existing OAuth reconnect errors retain their correct classification.
- Assert no API key, secret, token, authorization header or raw request configuration appears in serialized output, persisted results or new logs.
- Test manual/agent and recorded workflow propagation through existing harnesses; no real trade or credential is needed.

### History regression tests
Use React component tests with the actual BaseNode/InputPanel interaction, not just a pure resolver:
1. Open a completed run with executed-node data and an empty history semantic store. Flush effects. Selection settles once and data stays visible, with no repeated updates or maximum-depth warning.
2. Change dropdown to another executed node, search and scroll; trigger several five-second refresh cycles and unrelated sidebar insertions. Selection/content/tree/scroll remain stable.
3. Deliver an actual update to the selected running run: output updates, valid selection remains; completion is shown.
4. Switch runs, including runs sharing node IDs; data resets to the new run with no leakage from the previous run or live editor.
5. Empty/missing historical data never falls back to live data. Null/false/0/empty-string outputs remain intact.
6. ReadOnly InputPanel timestamp uses historical time; background renders do not advance it.
7. Live editor upstream selection repair still works after reconnect, node deletion and cluster projection changes.

Reproduce manually using the supplied screenshots' scenario: live strategy active, history auto-refresh checked, inspect Switch then Alpaca nodes, keep the panel open for at least three refresh intervals. Use React Profiler/render instrumentation to verify the selection no longer oscillates and static-store replacement does not happen for unchanged data. Remove temporary diagnostics.

Run existing targeted frontend/backend suites plus appropriate type/build checks for touched code using repository scripts. These are implementation acceptance checks; this planning commit does not claim runtime tests passed.

## Implementation order
1. Add regression reproduction for historical selection conflict and broker message propagation.
2. Fix readOnly selection ownership and verify blinking stops.
3. Stabilize historical derived arrays/provider refresh and truthful timestamps.
4. Add safe broker 401 context and verify propagation.
5. Run targeted checks and manual history refresh verification; review the diff for scope.

## Done when
- Wrong credential selection yields an actionable message rather than bare "unauthorized." in both node output and run history.
- A historical input panel stays visible and retains its chosen node while live activity and auto-refresh continue.
- Actual selected-run updates and run switching still work.
- No secrets are exposed, no trading behavior changes, and no unrelated engine or database rewrite is introduced.
