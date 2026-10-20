# BacktestInit: one attached broker instead of an embedded provider selector

Date: 2026-10-20  
Repository: Coreza-io/coreza  
Implementation target: dev only  
Reviewed dev snapshot: 93cf4523797b1de99560234421fc4034bbc06c62  
Status: implementation plan only; no application code changes.

## 1. Requested result and scope

Remove the editable Broker/Data Provider selection from BacktestInit. Give BacktestInit one bottom target connector labelled **Broker**, using the same attachment interaction and visual treatment as AI Agent's Chat Model/Tool inputs. Connect an existing Alpaca, Schwab, Binance, or Dhan node to that connector.

The attachment supplies the broker identity and saved credential reference. BacktestInit still owns symbols, start/end dates, interval, asset type, feed, adjustment, warm-up, capital, fill, slippage, and commission settings. This preserves existing historical-data and simulation semantics while removing duplicate provider/credential configuration.

The connected broker is a configuration dependency. BacktestInit requests historical candles through the existing HistoricalDataService; attaching it must never execute its selected account/order operation. Simulated orders continue through SimBroker.

This interprets “same as agent with tools” as the same editor attachment pattern and parent-owned dependency handling. It does not introduce an LLM into backtesting. Existing AI Agent tool mode remains supported.

## 2. Findings from the current dev code

| Area | Current behavior | Consequence |
| --- | --- | --- |
| src/nodes/BacktestInit.json | Has only the right output handle; provider is values.broker; credential_id depends on broker | Add a required bottom attachment and remove editable provider/credential fields |
| BacktestInit fields | asset_type, interval, feed, adjustment have rules depending on broker | Removing broker without a derived provider context would hide fields or empty interval options |
| src/components/nodes/NodeRouter.tsx | __isTool swaps a main node's handles for a top source handle named tool | Reuse the interaction/rendering approach, with a distinct broker attachment role |
| src/nodes/AIAgent.json and AIAgentExecutor.ts | AI dependencies connect source node to parent targetHandle; tools are invoked by the parent | New edge direction must also be broker → BacktestInit |
| src/hooks/useNodeExecution.ts | BacktestInit receives the full nodes/edges snapshot, but serialization omits some definition metadata and does not normalize tool roles in that full-graph branch | Standardize the metadata needed to resolve broker/support roles in manual execution |
| src/domain/workflowDocument.ts | Persists definition handles; getVisibleValues filters configured fields | Persist effective attachment handles/role; do not lose legacy broker credentials during save |
| src/utils/fieldVisibility.ts | Preserves a fixed list of system keys including __isTool | Explicitly preserve the new role and provider-dependent values |
| coreza-backend/src/engine/graphRuntime.ts | Entry nodes require zero incoming edges; dependency counts only skip sub-node sources | A broker attachment can prevent BacktestInit from starting even if the source is a support node |
| BacktestExecutor.extractStrategySubgraph | Walks downstream outgoing edges only | Keep main-path traversal separate from incoming support dependency closure |
| InitializeIndicatorsExecutor.discoverWarmupNodes | Walks outgoing edges without attachment classification | Warm-up discovery must stay on strategy flow |
| BacktestExecutor.executeBacktestInit | Reads provider and credential directly from params; creates the backtest row/SimBroker before validating those parameters | Resolve and validate the attachment before creating run resources |
| HistoricalDataService | Requests get_candle through BrokerExecutor for strategy and previous bars | Preserve this service and pass one resolved configuration to both requests |
| Broker registry | Runtime broker configs register Alpaca, Binance, Dhan, Schwab | Validate historical capability from runtime configuration, not merely category or dropdown entries |
| Schwab operations | Includes both get_price_history and a canonical get_candle adapter | Preserve get_candle normalization; no need to add a separate Schwab backtest executor |

Important existing limitation: BacktestInit lists Yahoo Finance, FMP, and Polygon, but HistoricalDataService currently routes all providers through BrokerExecutor, whose registry contains the four brokers above. Their presence in the selector does not prove working historical-data support. This change must not advertise new provider support or silently substitute Alpaca for an unsupported legacy selection.

## 3. Connection contract

### BacktestInit

Retain the existing right-side output handle and add:

```json
{
  "type": "target",
  "position": "bottom",
  "id": "broker",
  "label": "Broker",
  "connectionKind": "attachment",
  "required": true
}
```

The exact requirement/cardinality metadata must be supported by schemas and validators; JSON metadata alone is not enforcement.

### Attached broker

Introduce an explicit persisted role, for example values.__attachmentRole = "backtestBroker". This is a proposed new value, not an existing API. In this role, reuse the support-node card presentation and expose a top source handle:

```json
{
  "type": "source",
  "position": "top",
  "id": "broker",
  "connectionKind": "attachment"
}
```

The serialized edge is:

```json
{
  "id": "<canonical edge id>",
  "source": "<broker node id>",
  "sourceHandle": "broker",
  "target": "<BacktestInit node id>",
  "targetHandle": "broker"
}
```

Use a role rather than globally converting Alpaca/Schwab definitions into sub nodes. The same node types must still work as ordinary executable nodes and AI Agent tools.

Rules:

1. A BacktestInit requires exactly one broker attachment to execute. An incomplete graph can still be saved.
2. A candidate connection must use the correct source/target handles, registered provider identity, and historical-candle capability.
3. Reject a second broker connection with a clear message. Reconnect can replace the existing edge atomically.
4. Reject non-provider nodes, dangling sources, self-connections, invalid handles, and main-flow connections into the broker input.
5. One source broker configuration may supply more than one BacktestInit; resolve it independently in each run snapshot.
6. A node instance uses one role at a time: normal, AI tool, or backtest broker. To use separate roles simultaneously, duplicate the node.
7. Role changes that would invalidate existing edges are rejected with an actionable message until those edges are disconnected. Do not silently delete connections.
8. Cluster attachment boundary rules continue to apply. Connect canonical endpoints through the existing projection resolver.

## 4. Configuration ownership and precedence

| Setting | Authoritative owner |
| --- | --- |
| Provider identity | Trusted node definition/registered node-name mapping |
| credential_id | Attached broker node |
| Symbols and dates | BacktestInit |
| Interval and asset_type | BacktestInit |
| Feed and adjustment | BacktestInit |
| Warm-up and simulation settings | BacktestInit |
| Broker operation, order fields, account queries | Not used by the broker attachment |

In broker attachment mode, show the credential selector and a short explanation that BacktestInit controls the historical request. Hide operation/order/account fields and disable the node's standalone execute control. Preserve existing normal/tool-mode configuration so switching roles does not destroy it.

Do not require get_candle, symbol, date, order quantity, or accountHash just to configure an attachment. Provider-specific fields genuinely required for historical requests should be declared in provider metadata and normalized explicitly; never forward the entire broker node values object.

Resolve the attached credential as server-owned configuration. BacktestInit values or incoming payload data must not override it. Backend maps the canonical node type to a registered provider and verifies credential ownership/service through existing credential access. Do not trust client-supplied category, broker, or subCategory as authorization.

Keep any derived broker identifier used for UI conditions transient. It must not reintroduce an independently editable provider field or shadow credential in BacktestInit.

## 5. Frontend implementation

### A. Effective role and handles

Add a small shared role/effective-handle resolver for normal, existing tool, and backtest broker modes. Use it in:

- NodeRouter handle rendering and role controls.
- Canonical serialization and export.
- Edge semantic classification.
- Run payload serialization and standalone execution eligibility.

Keep __isTool backward compatible. Do not replace existing tool values or reinterpret every tool attachment as a broker attachment. Keep source and target attachment kinds explicit.

Extend src/nodes/schemas/nodeSchema.ts as needed for supported handle labels/requirements and provider metadata. Its current HandleSchema contains type, position, id, connectionKind only; its NodeConfigSchema also does not declare the existing broker metadata field. Preserve trusted broker metadata through parsing and loading.

### B. BacktestInit fields

Remove the visible broker and credential_id controls. Retain the historical and simulation fields listed above.

Derive provider-sensitive options from the connected broker using a narrow canonical-store selector. Feed a derived field-evaluation context into visibility, conditional options, and required-field validation. Do not mutate saved values merely to render provider conditions.

Cover field rendering, payload construction, persistence filtering, previews, and server validation consistently. An interval valid for Alpaca may be invalid for Binance. On reconnect, retain valid values and clearly flag invalid ones; do not silently pick a different interval or asset type.

With no attachment, keep user-entered historical settings intact and show “Connect a broker to configure provider options.” Missing connection blocks execution, not save.

### C. Connection transactions

In WorkflowEditor.onConnect/onReconnect, run role/cardinality/endpoint validation after resolving projected endpoints and before committing the canonical candidate.

Check import, paste, undo/redo, reload, and server submission too; canvas drag validation is not sufficient. Keep normal canonical history, mutation guards, and UUID edge identity. Edge removal happens once through the canonical transaction.

### D. Payloads and persisted documents

Make manual BacktestInit, Run All, activation/backtest lifecycle, cluster execution, and exported/imported workflows carry consistent:

- Canonical node id and node type/name.
- Attachment role and effective handles.
- Provider lookup metadata where required.
- Raw relevant values and credential reference.
- Edge ids and sourceHandle/targetHandle.

Update the full BacktestInit serialization branch in useNodeExecution, not only support_nodes for AI Agent. Check editor execution services and the canonical serializer for alternate paths.

Preserve __attachmentRole through getVisibleValues. Persist provider-dependent BacktestInit fields using the connected provider context rather than treating a deleted values.broker as absent and filtering those fields away. Do not persist secrets, generated handles from cluster projections, execution highlights, or a second authoritative provider selection.

## 6. Backend implementation

### A. One attachment resolver

Create a focused helper, e.g. resolveBacktestBrokerAttachment(initNode, canonicalNodes, canonicalEdges, executionContext). It returns a small immutable configuration:

```ts
type ResolvedBacktestBroker = {
  brokerNodeId: string;
  provider: string;
  credentialId: string;
};
```

Expand optional provider settings only when the existing historical request supports them.

The resolver must:

1. Match the exact BacktestInit id and targetHandle broker.
2. Enforce exactly one canonical edge.
3. Resolve the source and its effective source handle.
4. Validate a recognized provider node and backtest broker role.
5. Verify registered get_candle support.
6. Resolve its configured credential reference with the current execution snapshot and existing parameter resolver where supported.
7. Reject unresolved references and mismatched credentials with a node-specific error.
8. Return configuration without invoking the broker node's action.

Use the same helper from BacktestExecutor for direct /backtest/init and server-owned execution. No duplicated provider switch in routes or frontend. For new-format requests, attachment errors never fall back to params.broker.

### B. Initialization order and historical requests

Resolve attachment, validate historical settings/capabilities, and validate workflow ownership before inserting a running backtest or creating SimBroker state.

Replace direct params.broker/params.credential_id reads with the resolved attachment. Keep existing symbol parsing, date behavior, candle normalization, multi-symbol handling, cancellation, and output contract.

Both strategy fetchRange and warm-up fetchPreviousBars use the exact same resolved provider and credential, with the same BacktestInit asset/feed/adjustment configuration. Resolve once per initialization, not per symbol or bar.

Keep HistoricalDataService → BrokerExecutor → registered get_candle adapters. Avoid a new HTTP round trip to execute the attached card or fetch an already-rendered node output. Do not use cached output as the historical-data source.

Errors must use current node result/error publication and cleanup behavior. New preflight failures should leave no running backtest row or cached simulation instance.

### C. Main execution graph versus attachment context

Introduce/reuse one semantic edge classifier in the relevant runtime boundary. Preserve the complete canonical inventory for parameter resolution and attachment lookup, while scheduling only main-flow edges and executable nodes.

Audit and update:

- GraphRuntime entry detection: BacktestInit has no incoming MAIN edges, even when its Broker input is attached.
- Dependency descriptors, required counts, traversal, branch origins, and topological sort.
- Frontend WorkflowExecutor start/dependency checks and support-node exclusion.
- Backend plan/executor selection and execution entry points.
- Backtest strategy extraction and warm-up discovery.
- Compiled eligibility/plan construction and interpreted fallback.

Do not fix entry detection alone. The broker node must not become an independent root, a compiled opcode, a prerequisite execution result, or a per-bar task.

Preserve current agent behavior: strategy extraction should walk downstream MAIN edges, then retain the transitive incoming attachment dependencies needed by reachable parent nodes (chat model, memory, tools). Keep those dependencies available in context without scheduling them. An upstream broker attached only to BacktestInit does not belong in the per-bar strategy.

This closure is bounded by the captured graph and cycle/endpoint validation. Do not traverse all outgoing paths from support nodes into unrelated workflows or parents.

### D. Trusted definitions and validation

Extend backend node-definition metadata only as required for provider/role resolution. Use trusted loaded definitions/runtime registries to validate submitted node identities.

Apply the same attachment/cardinality rules at save/import and execution boundaries. Server validators must understand dynamic effective handles, rather than comparing a rendered broker source handle with the original main output handle.

Preserve existing cluster rules, including attachment boundaries, disconnected saved members, canonical identity, and hierarchy guards. No database schema change is expected for a role inside node values and a normal edge; verify existing request/schema allowlists before implementation.

## 7. Legacy workflows and migration

Removing the old fields can otherwise erase credentials and provider-dependent settings on the next save. Implement migration before new-definition field filtering.

For a legacy BacktestInit with values.broker and no broker attachment:

1. Preserve all original values while detecting its format.
2. For a supported broker, create a dedicated broker attachment node with the same credential reference.
3. Allocate its identity/display name through src/domain/nodeNaming.ts against the complete canonical inventory.
4. Connect it to the broker target with fresh canonical edge identity; keep BacktestInit's existing id and output edges.
5. Preserve every historical and simulation value exactly, including provider-native interval strings.
6. If BacktestInit is clustered, create the attachment in the same direct cluster ownership using document commands and normal layout/insertion rules.
7. Commit the migration as one reviewable document/history transaction. Do not automatically write the database just because the editor loads.
8. Re-running migration is idempotent; it must not create duplicate nodes or edges.

For malformed/unsupported legacy providers, preserve their raw configuration and show a repair diagnostic. Do not drop Yahoo/FMP/Polygon values or migrate them to a broker with different behavior.

For existing legacy requests and server activation, use a temporary explicit old-format normalization step shared with editor migration or a deterministic legacy resolver. New-format attachment requests remain strict. Do not let a dangling/deleted new attachment activate legacy fallback.

Backend compatibility must ship before the frontend removes fields. Remove legacy execution support only after existing saved workflows have a documented migration path. No bulk database rewrite is needed for this feature.

## 8. Error and activity behavior

Examples:

- “Connect one broker to Backtest Init.”
- “Backtest Init already has a broker. Reconnect or remove the existing connection.”
- “The attached node does not support historical candles.”
- “Choose a credential on Alpaca1.”
- “Interval 1Day is not valid for the attached Binance provider.”
- “The attached broker node no longer exists.”

Detailed errors go to Output Data under existing guarded error publication rules. The BacktestInit execution indicator owns initialization; the attachment may show a dependency activity state while its history request is active, if this fits existing activity events.

Log a bounded broker-resolution/history summary with BacktestInit id, broker node id, provider, symbol, interval, range, and warm-up/main phase. Reuse current logging/redaction. Never log API secrets or dump credentials. Do not create fake AI tool invocation events for a backtest dependency.

## 9. File-level implementation map

| File/area | Planned work |
| --- | --- |
| src/nodes/BacktestInit.json | Broker target; remove provider/credential controls; preserve historical settings |
| src/nodes/schemas/nodeSchema.ts | Metadata support required for effective handles/provider resolution |
| src/components/nodes/NodeRouter.tsx | Backtest broker role; top handle; attachment card/execute behavior |
| Node layout and field rendering | Role-sensitive configuration and derived provider field context |
| src/pages/WorkflowEditor.tsx | Canonical connect/reconnect validation and migration transaction |
| src/domain/workflowDocument.ts | Persist effective role/handles and context-aware field values |
| src/utils/fieldVisibility.ts | Preserve role and provider-dependent values |
| src/domain/clusters/edgeSemantics.ts | Recognize effective broker attachment handles |
| src/hooks/useNodeExecution.ts | Full graph serialization and manual execution context |
| src/utils/workflowExecutor.ts | Main-edge dependency/start logic; attachment exclusion |
| Export/import/persistence/activation services | Consistent role, metadata, graph snapshots, migration |
| coreza-backend/src/nodes/nodeDefinitions.ts | Trusted provider/effective handle metadata |
| New focused attachment helpers | Resolve/validate one broker; canonical/main graph classification |
| coreza-backend/src/backtest/BacktestExecutor.ts | Preflight resolver, shared history configuration, strategy/support closure |
| coreza-backend/src/routes/backtest.ts | Preserve graph context and explicit legacy/new request handling |
| coreza-backend/src/engine/graphRuntime.ts and workflowPlan.ts | Scheduling semantics and full dependency context |
| InitializeIndicatorsExecutor.ts | Main-path warm-up discovery |
| BacktestSession.ts / compiled compiler | Verify no dependency execution or lost agent attachments |
| coreza-backend/src/workflow/validateNodeClusters.ts and request schemas | Persisted handle/role/cardinality validation |
| src/templates/workflows/backtest.json | Example migrated to broker attachment |
| Focused frontend/backend tests | Contract, execution parity, migration, serialization |

These are scoped change points, not a requirement to rewrite every listed module. Modify only the entry points demonstrated to need the shared contract.

## 10. Validation matrix

| Scenario | Required result |
| --- | --- |
| Alpaca attachment, single symbol | Same candles, portfolio, trades, and output structure as legacy baseline |
| Schwab attachment | Canonical get_candle adapter used; no account/order operation executed |
| Binance spot/futures and Dhan | Existing normalization/request behavior preserved; unsupported combinations fail clearly |
| Missing/two/dangling/non-broker attachments | Deterministic validation error before run resources are created |
| Duplicate connection and reconnect | Exactly one persisted canonical edge; one undoable change |
| Broker selected operation is place_order | No order call is made by attachment initialization or replay |
| Manual BacktestInit → OnBar | Init succeeds with incoming attachment; stepping uses same session |
| Execute All and lifecycle activation | BacktestInit starts; broker does not execute as root or on every bar |
| Cluster Execute | Normal action path retained; canonical broker dependency is available |
| Interpreted and compiled backtests | Same strategy results; attachment not an opcode or scheduling dependency |
| Warm-up disabled/seed/replay | Same boundaries, bars, provider settings, and readiness as baseline |
| Multiple symbols | Same credential/provider snapshot for all symbol requests |
| AI Agent in strategy with tools/model/memory | Incoming support closure retained and invoked only by the agent |
| AI Agent outside backtest | Existing tool mode, parameter logging, activity highlights, and routing unchanged |
| Save/reload/export/import/copy/paste/undo | Role, effective handles, credential reference, and dependent fields survive |
| Collapsed/expanded clusters | Attachment endpoints remain canonical and boundary policy agrees client/server |
| Legacy migration twice | One dedicated attachment, original BacktestInit id/settings, no duplicate edge |
| Unsupported legacy Yahoo/FMP/Polygon | Original values retained with explicit repair/unsupported diagnostic |
| Wrong-user or wrong-provider credential | Existing credential authorization rejects access; no secrets exposed |
| Editor change during a captured run | Active run uses its immutable configuration snapshot |

Use mocked candle/credential adapters and a deterministic fixture for parity; compare provider requests, warm-up bars, trade/order records, equity, and output shape. Do not use real trading calls.

Run node-definition validation, frontend build, backend TypeScript build, and focused contract/runtime/migration tests. Re-run existing graph, cluster, backtest warm-up, and agent support-node tests touched by shared classification. Use targeted browser checks for connector drag/reconnect, save/reload, and role switching.

Since this deliverable is a plan, these implementation checks have not been executed.

## 11. Implementation order and completion criteria

1. Define role, effective handles, provider lookup, and edge validation; add contract fixtures.
2. Implement backend resolver/preflight and graph scheduling/context separation with legacy normalization.
3. Add frontend broker role/card, BacktestInit handle, derived field context, and consistent serialization.
4. Add migration and update the example template.
5. Complete parity, agent regression, cluster, persistence, and execution-path validation.
6. Ship backend compatibility before frontend authoring/removal of the old selector.

Complete when a user can attach exactly one supported broker to BacktestInit, select credentials on that broker, and obtain the same backtest behavior through manual, Run All, cluster, and lifecycle paths. Provider dependencies must never execute as ordinary workflow nodes or place live orders merely because they were attached.

## Source references

All findings were read at the reviewed dev snapshot above. Key files:

- [BacktestInit definition](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/nodes/BacktestInit.json)
- [NodeRouter](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/components/nodes/NodeRouter.tsx)
- [BacktestExecutor](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/backtest/BacktestExecutor.ts)
- [GraphRuntime](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/engine/graphRuntime.ts)
- [HistoricalDataService](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/marketData/HistoricalDataService.ts)
- [Canonical serializer](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/domain/workflowDocument.ts)
- [AI Agent executor](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/nodes/executors/AIAgentExecutor.ts)
