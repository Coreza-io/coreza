# BacktestInit: one attached broker instead of an embedded provider selector

Date: 2026-10-20  
Repository: Coreza-io/coreza  
Implementation target: dev only  
Reviewed dev snapshot: 93cf4523797b1de99560234421fc4034bbc06c62  
Status: implementation plan only; no application code changes.

## 1. Requested result and scope

Remove the editable Broker/Data Provider selection from BacktestInit. Give BacktestInit one bottom target connector labelled **Broker**, using the same attachment interaction and visual treatment as AI Agent's Chat Model/Tool inputs. Connect an existing Alpaca, Schwab, Binance, or Dhan node to that connector.

The attachment supplies the complete historical-data configuration: provider, credentials, symbols, start/end dates, interval, asset type, feed, adjustment, and other supported provider options. BacktestInit contains only backtest name, initial capital, warm-up settings, and simulation model settings. Symbols, dates, interval, and provider controls must not remain duplicated or hidden as authoritative values in BacktestInit.

Here “model” means the existing fill, slippage, and commission model settings, including their required values; “warm-up” includes warmup_period and warmup_mode. These stay as the existing controls/groups; no new AI model selector is introduced.

The connected broker is a configuration dependency. BacktestInit requests historical candles through the existing HistoricalDataService; attaching it must never execute its selected account/order operation. Simulated orders continue through SimBroker.

This interprets “same as agent with tools” as the same editor attachment pattern and parent-owned dependency handling. It does not introduce an LLM into backtesting. Existing AI Agent tool mode remains supported.

## 2. Findings from the current dev code

| Area | Current behavior | Consequence |
| --- | --- | --- |
| src/nodes/BacktestInit.json | Has only the right output handle; provider is values.broker; credential_id depends on broker | Add a required bottom attachment and remove editable provider/credential fields |
| BacktestInit fields | asset_type, interval, feed, adjustment have rules depending on broker | Remove these historical-data fields from BacktestInit and use the attached broker's existing controls and validation |
| src/components/nodes/NodeRouter.tsx | __isTool swaps a main node's handles for a top source handle named tool | Reuse the interaction/rendering approach, with a distinct broker attachment role |
| src/nodes/AIAgent.json and AIAgentExecutor.ts | AI dependencies connect source node to parent targetHandle; tools are invoked by the parent | New edge direction must also be broker → BacktestInit |
| src/hooks/useNodeExecution.ts | BacktestInit receives the full nodes/edges snapshot, but serialization omits some definition metadata and does not normalize tool roles in that full-graph branch | Standardize the metadata needed to resolve broker/support roles in manual execution |
| src/domain/workflowDocument.ts | Persists definition handles; getVisibleValues filters configured fields | Persist effective attachment handles/role; do not lose legacy broker credentials during save |
| src/utils/fieldVisibility.ts | Preserves a fixed list of system keys including __isTool | Preserve the new role and the attached broker's historical configuration |
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
| Symbols and dates | Attached broker node |
| Interval and asset type | Attached broker node |
| Feed, adjustment, and supported historical options | Attached broker node |
| Backtest name and initial capital | BacktestInit |
| Warm-up period and mode | BacktestInit |
| Fill, slippage, commission models and values | BacktestInit |
| Historical operation | Attached broker's historical operation, normalized through the existing adapter |
| Order/account operations | Invalid for backtest attachment execution |

In broker attachment mode, reuse the broker node's existing historical operation form: credentials, symbol, interval, dates, asset type, and provider-specific historical options. For example, Alpaca already has get_candle with symbol/crypto_base/crypto_quote, interval, start, end, feed, adjustment, currency, and sort. Keep this form as the single editing surface. Disable standalone execute while attached; BacktestInit owns fetching, warm-up, and session creation.

Only historical operations are valid in this role. Restrict the operation selector to registered historical operations or show the existing historical operation as fixed. Normalize Schwab get_price_history through its existing get_candle adapter; preserve equivalent frequency/date options. If a node previously had place_order selected, entering attachment mode must not execute or silently reinterpret it: require a valid historical configuration and retain the prior normal/tool-mode settings without losing them.

Validate the historical fields required by the selected provider/operation before execution. Do not require unrelated order quantity or account-only fields. Declare field mappings and supported options in provider metadata/adapters; never forward the entire values object to a broker API.

Resolve the attached credential as server-owned configuration. BacktestInit values or incoming payload data must not override it. Backend maps the canonical node type to a registered provider and verifies credential ownership/service through existing credential access. Do not trust client-supplied category, broker, or subCategory as authorization.

All historical values resolve from the attached broker's captured configuration. New-format BacktestInit payloads must not override them through old broker, credential_id, symbols, start_date, end_date, interval, asset_type, feed, or adjustment fields. Any normalized configuration retained by the backend belongs to the immutable run/session, not to editable BacktestInit values.

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

Retain only these editable settings:

- name: Backtest Name.
- initial_capital: Initial Capital.
- warmup_period and warmup_mode: Warm-up settings.
- fill_model, slippage_model/slippage_value, commission_model/commission_value: Simulation model settings.

Remove broker, credential_id, symbols, start_date, end_date, asset_type, interval, feed, and adjustment from BacktestInit. Do not add a description field or a hidden second copy of historical configuration.

Keep the one bottom Broker attachment and the existing main output. An optional read-only attachment label can identify the connected node; it must not become another configuration form. Provider-sensitive fields and validation stay on the broker's existing form. No derived provider field context is needed in BacktestInit.

With no attachment, show “Connect a broker and configure historical data on that node.” Missing connection blocks execution, not save. Reconnecting changes the historical configuration to that of the newly attached broker; it does not copy old BacktestInit data over the new broker.

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

Preserve __attachmentRole through getVisibleValues and serialize the broker's historical-operation fields using its effective operation/field visibility. The attached broker stores credentials and all historical options; BacktestInit stores only its retained settings. Run migration before removed legacy fields can be filtered away. Do not persist secrets, generated handles from cluster projections, execution highlights, or a second historical configuration in BacktestInit.

## 6. Backend implementation

### A. One attachment resolver

Create a focused helper, e.g. resolveBacktestBrokerAttachment(initNode, canonicalNodes, canonicalEdges, executionContext). It returns a small immutable configuration:

```ts
type ResolvedBacktestBroker = {
  brokerNodeId: string;
  provider: string;
  credentialId: string;
  symbols: string[];
  interval: string;
  start: string;
  end: string;
  assetType?: string;
  feed?: string;
  adjustment?: string;
  providerOptions?: Record<string, unknown>; // validated historical allowlist only
};
```

Normalize the broker's native historical fields into this request, retaining supported provider-specific options. Proposed names describe the internal request contract, not new fields to add to every broker form. Reuse existing adapters and extend the request narrowly where the service currently drops a supported broker option.

The resolver must:

1. Match the exact BacktestInit id and targetHandle broker.
2. Enforce exactly one canonical edge.
3. Resolve the source and its effective source handle.
4. Validate a recognized provider node and backtest broker role.
5. Verify registered get_candle support.
6. Resolve the attached broker's credential and historical parameters with the current execution snapshot and existing parameter resolver.
7. Normalize provider field names: symbol/symbols and crypto pair fields; start/end, start_date/end_date, or startTime/endTime; interval versus supported frequency fields; assetType/marketType versus asset_type. Put mappings beside provider adapters rather than hardcoding them throughout BacktestExecutor.
8. Validate the historical operation, requested range, symbols, interval, provider options, unresolved references, and credential ownership/service.
9. Preserve existing date/timezone/range boundary semantics. Resolve relative/lookback dates once per initialization using the broker's existing date-mode logic, so main and warm-up requests share one anchor.
10. Return configuration without executing arbitrary broker node actions.

Use the same helper from BacktestExecutor for direct /backtest/init and server-owned execution. No duplicated provider switch in routes or frontend. For new-format requests, attachment errors never fall back to params.broker.

### B. Initialization order and historical requests

Resolve attachment, validate historical settings/capabilities, and validate workflow ownership before inserting a running backtest or creating SimBroker state.

Replace all historical reads from BacktestInit params with the resolved attached broker configuration, including provider, credential, symbols, dates, interval, asset type, feed, and adjustment. The backtest record's start_date/end_date and session metadata must come from this same normalized configuration. Keep candle normalization, cancellation, and downstream output contracts.

Preserve multi-symbol backtests: normalize the broker's symbol/symbols field into the existing per-symbol request list. If a broker form currently restricts input to one symbol, extend only that historical-operation input to support the existing backtest symbol-list behavior with explicit validation. Do not add Symbols back to BacktestInit.

Both strategy fetchRange and warm-up fetchPreviousBars use the same resolved broker configuration. Warm-up starts strictly before the broker's resolved start date, uses BacktestInit's warmup_period/mode, and keeps the broker's symbol, interval, asset, feed, adjustment, and supported request options. Resolve configuration once per initialization, not per symbol or bar.

Honor the requested backtest date range rather than accidentally truncating the simulation to the broker UI's optional limit or one page. Keep existing pagination/full-range behavior, with warm-up counts controlled by BacktestInit. Validate or normalize sort consistently; do not treat a saved page_token as the beginning of the historical range. Define these request-control rules in the historical adapter and cover them with tests.

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

Apply the same endpoint, role, and maximum-one attachment rules at save/import and execution boundaries. Save/import may retain an incomplete graph with no broker; execution requires exactly one. Server validators must understand dynamic effective handles, rather than comparing a rendered broker source handle with the original main output handle.

Preserve existing cluster rules, including attachment boundaries, disconnected saved members, canonical identity, and hierarchy guards. No database schema change is expected for a role inside node values and a normal edge; verify existing request/schema allowlists before implementation.

## 7. Legacy workflows and migration

Removing the old fields can otherwise erase credentials and provider-dependent settings on the next save. Implement migration before new-definition field filtering.

For a legacy BacktestInit with values.broker and no broker attachment:

1. Preserve all original values while detecting its format.
2. For a supported broker, create a dedicated broker attachment node and move its credential, symbols, dates, interval, asset type, feed, and adjustment into the provider's native historical fields. Select its valid historical operation. Map names through the same provider adapter used at runtime.
3. Allocate its identity/display name through src/domain/nodeNaming.ts against the complete canonical inventory.
4. Connect it to the broker target with fresh canonical edge identity; keep BacktestInit's existing id and output edges.
5. Preserve effective historical requests exactly, including provider-native interval strings, date boundaries, multi-symbol lists, and crypto symbol conventions. Keep only name, initial capital, warm-up, and model settings on BacktestInit after successful migration; remove old historical fields only after equivalent broker values have been validated. Retain the original candidate on migration failure.
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
- “Interval 1Day on Binance1 is not valid for its historical operation.”
- “Configure a historical operation, symbol, interval, and date range on Alpaca1.”
- “The attached broker node no longer exists.”

Detailed errors go to Output Data under existing guarded error publication rules. The BacktestInit execution indicator owns initialization; the attachment may show a dependency activity state while its history request is active, if this fits existing activity events.

Log a bounded broker-resolution/history summary with BacktestInit id, broker node id, provider, symbol, interval, range, and warm-up/main phase. Reuse current logging/redaction. Never log API secrets or dump credentials. Do not create fake AI tool invocation events for a backtest dependency.

## 9. File-level implementation map

| File/area | Planned work |
| --- | --- |
| src/nodes/BacktestInit.json | Broker target; retain only name, initial capital, warm-up, and model settings |
| src/nodes/schemas/nodeSchema.ts | Metadata support required for effective handles/provider resolution |
| src/components/nodes/NodeRouter.tsx | Backtest broker role; top handle; attachment card/execute behavior |
| Broker node definitions, adapters, and field rendering | Reuse historical forms; normalize native symbols/dates/interval/options; role-sensitive operation validation |
| src/pages/WorkflowEditor.tsx | Canonical connect/reconnect validation and migration transaction |
| src/domain/workflowDocument.ts | Persist effective role/handles and broker-owned historical values |
| src/utils/fieldVisibility.ts | Preserve role and broker historical fields; avoid legacy data loss |
| src/domain/clusters/edgeSemantics.ts | Recognize effective broker attachment handles |
| src/hooks/useNodeExecution.ts | Full graph serialization and manual execution context |
| src/utils/workflowExecutor.ts | Main-edge dependency/start logic; attachment exclusion |
| Export/import/persistence/activation services | Consistent role, metadata, graph snapshots, migration |
| coreza-backend/src/nodes/nodeDefinitions.ts | Trusted provider/effective handle metadata |
| New focused attachment helpers | Resolve/validate one broker; canonical/main graph classification |
| coreza-backend/src/backtest/BacktestExecutor.ts | Preflight resolver, shared history configuration, strategy/support closure |
| coreza-backend/src/routes/backtest.ts | Pass retained init settings and graph; legacy/new normalization; remove new-format reliance on flat historical params |
| coreza-backend/src/marketData/HistoricalDataService.ts and provider adapters | Carry complete normalized broker historical options consistently into main/warm-up requests |
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
| Broker selected operation is place_order | Reject invalid historical attachment configuration; no order call is made |
| Manual BacktestInit → OnBar | Init succeeds with incoming attachment; stepping uses same session |
| Execute All and lifecycle activation | BacktestInit starts; broker does not execute as root or on every bar |
| Cluster Execute | Normal action path retained; canonical broker dependency is available |
| Interpreted and compiled backtests | Same strategy results; attachment not an opcode or scheduling dependency |
| Warm-up disabled/seed/replay | Same boundaries, bars, provider settings, and readiness as baseline |
| Multiple symbols configured on broker | Normalize list and preserve per-symbol requests with the same credential/provider snapshot |
| Broker fields edited or reconnected | Next run uses that broker's symbols/dates/interval/options; no stale BacktestInit override |
| Broker expression/lookback dates | Resolve once from the captured context; main and warm-up share boundaries |
| Broker limit/sort/page options | Full requested range and chronological simulation preserved; no silent truncation |
| BacktestInit form/payload | Only name, initial capital, warm-up and simulation model settings; one Broker connector |
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
3. Add frontend broker role/card with its existing historical form, reduce BacktestInit to the retained fields, and update serialization.
4. Add migration and update the example template.
5. Complete parity, agent regression, cluster, persistence, and execution-path validation.
6. Ship backend compatibility before frontend authoring/removal of the old selector.

Complete when BacktestInit contains only name, initial capital, warm-up, and simulation model settings; a user configures all historical data on exactly one attached broker; and manual, Run All, cluster, and lifecycle execution use that broker's configuration consistently. Provider dependencies must never execute as ordinary workflow nodes or place live orders merely because they were attached.

## Source references

All findings were read at the reviewed dev snapshot above. Key files:

- [BacktestInit definition](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/nodes/BacktestInit.json)
- [NodeRouter](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/components/nodes/NodeRouter.tsx)
- [BacktestExecutor](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/backtest/BacktestExecutor.ts)
- [GraphRuntime](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/engine/graphRuntime.ts)
- [HistoricalDataService](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/marketData/HistoricalDataService.ts)
- [Canonical serializer](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/src/domain/workflowDocument.ts)
- [AI Agent executor](https://github.com/Coreza-io/coreza/blob/93cf4523797b1de99560234421fc4034bbc06c62/coreza-backend/src/nodes/executors/AIAgentExecutor.ts)
