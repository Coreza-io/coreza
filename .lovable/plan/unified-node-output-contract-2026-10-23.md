# Coreza unified node result contract and shared output program

Date: 2026-10-23  
Repository: Coreza-io/coreza  
Reviewed dev snapshot: 2844aa991344dc5262fdb05289ac5fe3e79fc8b4  
Status: analysis and implementation plan only. No runtime implementation in this change.

## 1. Recommendation

Use one browser-safe TypeScript result contract and one shared set of result constructors, validators, compatibility adapters, and serializers across Coreza. Every executable node should return the same outer envelope. Each node retains its own typed payload under `data`.

Retain the existing expression convention `$("Node").json.data...`, scheduler, streaming event model, and compiled backtest VM.

The shared program should standardize result construction and interpretation. It should not compute indicators, translate every broker response, decide branches, execute loops, persist variables, send UI notifications, or summarize data for an LLM. Those remain separate responsibilities.

Success criteria:

- Every executable invocation produces one recognized result, regardless of manual, cluster, Run All, live, classic backtest, compiled backtest, or AI tool entry.
- Frontend, server, persisted history, input/output panels, and expression preview agree on the same envelope.
- Structured diagnostics and domain metadata survive all conversions.
- Runtime control stays available to the engine and never leaks into ordinary expression payloads or graph documents.
- Existing payload paths and trading/execution behavior remain compatible.
- The shared helper preserves synchronous execution and avoids payload-sized work in the per-bar path.

## 2. Scope and confidence

Inspected all 73 JSON node definitions in `src/nodes`, all 17 executor files in `coreza-backend/src/nodes/executors`, backend and frontend output types/normalizers, classic execution runtime, compiled adapters/VM, node store, frontend node execution/panels, reference-source selection, listening helpers, persisted-result interpretation, AI tool processing, representative HTTP routes, and backtest execution integration.

The 73 definitions are an inventory of authored node types, not 73 independently implemented executors. Several are configuration attachments or use category mapping, direct endpoints, or frontend-local actions. Public `category` labels are not always executor registry keys: `categoryMap.ts` is relevant.

This is a static source review. No app session, broker call, production history migration, runtime benchmark, or full test suite was executed. The contract and acceptance criteria below are proposed implementation work, not measured improvements. Some route families were sampled rather than audited operation by operation; phase 0 must complete that call-site matrix.

Read repository `AGENTS.md`. Preserve its canonical graph rules, guarded failure publication, cluster-local sequencing, bounded expression behavior, and variable persistence/ownership guarantees.

## 3. What is inconsistent today

### A. The existing standard is duplicated and already differs

Files:

- `src/types/nodeOutput.ts`
- `coreza-backend/src/types/nodeOutput.ts`
- `src/utils/normalizeOutput.ts`
- `coreza-backend/src/utils/normalizeOutput.ts`

Both types claim to be the unified format, but the frontend recognizes `skipped`, `cancelled`, and `not-executed` while the backend guard does not. Frontend metadata requires a timestamp; backend metadata makes it optional. Metadata fields also differ.

Both normalizers create timestamps and merge metadata. Calling them during repeated reading/rendering can manufacture new objects and observation times. Backend `createSuccessOutput(data, context)` ignores its context; frontend's version adds context metadata. These are different behaviors behind the same function name.

### B. The conversion back to NodeResult loses information

Backend `toNodeResult()` returns only `success/data/error/meta`. It drops standard `status` and `details`. It cannot preserve control or additional diagnostic properties through that projection.

Consequences visible from source:

- `createErrorOutput()` creates HTTP status/code/response details, which callers then lose through `toNodeResult()`.
- Waiting/listening/streaming results may lose their outer status after normalization and conversion.
- Many executor branches return hand-built legacy objects, while other branches call standard helpers. A category therefore has several result conventions.

This is a conversion defect, not evidence that every runtime call currently fails.

### C. Generic payload guessing can discard legitimate data

Backend `normalizeOutput()` treats any object with a boolean `success`, a truthy `error`, or a defined `data` property as an execution envelope. A provider payload such as `{data: [...], pagination: {...}}` can lose its siblings. Frontend does not use the same `data` heuristic.

Both sides also interpret status-like properties. A broker order with domain `status: "open"` is payload data, not a node lifecycle state. A shared implementation must distinguish explicit payload construction from decoding a known legacy envelope. Do not recursively search for `data`, `success`, `status`, or `json`.

### D. Classic and compiled runtime boundaries differ

`engine/executionRuntime.ts::normalizeResult` throws a new Error for an unsuccessful result. It preserves owned child snapshots first, but the ordinary throw carries the message rather than the original structured diagnostic object.

`backtest/compiled/adapters.ts::normalizeResult` reconstructs failed results with only success/data/error/meta/control, losing extra diagnostic fields. It also supports implicit raw results, using a `raw.data ?? raw` fallback. That fallback cannot reliably distinguish an explicit null payload from missing data.

`compiled/vm.ts` depends directly on result.data for branches and uses compact slot results for speed. These are important compatibility constraints.

### E. Manual execution does not converge automatically with server execution

`src/hooks/useNodeExecution.ts` handles:

- frontend-local actions and loops;
- HTTP responses;
- variable snapshot transport;
- AI activity transport;
- listener creation;
- success/failure publication.

Its normal success path assigns the response object to output and publishes it. Fixing backend executor helpers alone will not standardize all frontend-local outputs, endpoint-specific responses, or listener events.

`routes/indicators.ts` also returns results from IndicatorService/state helpers directly for RSI/EMA/etc.; these manual endpoints do not all simply call IndicatorsExecutor. `routes/broker.ts` explicitly reconstructs a success response. Both need deliberate integration.

### F. Listeners create additional output formats

`useListeningConfigs.ts` constructs listening/waiting outputs and timeout/error/expired states separately. `useListeningHandler.ts` publishes their updates. These states are outside the current backend standard status list.

Subscription acknowledgement, waiting, timeout, and an emitted market event must have clear meanings. A timeout must not be silently converted to successful payload data.

### G. History already has another compatibility reader

`src/utils/persistedNodeResult.ts` interprets legacy persisted nodeResults. It should become a facade over a source-aware shared decoder rather than an independent source of truth. Reading old history must not replace original timestamps with the current viewing time.

Keep workflow-run envelopes separate: a run's `result.nodeResults` is a map of node results, not one node result. Likewise HTTP run IDs, pagination, and variable snapshots are transport data.

### H. UI rendering can hide diagnostics even when they exist

`OutputPanel.tsx` projects standard output into success/status/error/data. In that projection it omits details/meta. Standardizing producers without updating the output diagnostics view would still leave information inaccessible.

InputPanel, useNodeOutput, persisted results, reference drag/drop, and typed expression source selection need a consistent view of output. The result helper must not be called as a render-time wrapper that allocates a fresh result on every read.

### I. AI tools have a deliberate secondary representation

`AIAgentExecutor.ts` directly invokes executors, then `processToolOutput()` creates summaries/dataRef/rowCount/type for the LLM. It has indicator readiness handling and historical-candle reference storage.

This is not just an accidental output inconsistency. The model-facing tool response is a bounded projection of the canonical node result. Preserve it as an adapter, with explicit types, rather than replacing it with huge canonical payloads or forcing its summary back into ordinary node output.

### J. Loop and trading flags are not cosmetic fields

NodeResult contains `control`, broker diagnostic code/provider/recoverable, and warmupSuppressed. LoopV2 additionally returns a separate output/trueItems/falseItems-style contract. Routing uses flags such as suppressRouting, loopCompleted, loopIteration, sourceHandle, parallelDistributed, and ownedNodeResults.

A naive "return only success/status/data/error/meta" migration can change execution behavior even when the UI looks correct.

## 4. Coreza result contract requirements

Use shared infrastructure and explicit contracts to address the lossy conversions
identified above. Keep payload data separate from execution status and routing.

| Requirement | Coreza decision |
| --- | --- |
| Stable container, variable business payload | One result envelope with typed data |
| Reusable construction/normalization helpers | Shared pure helpers and explicit boundary decoding |
| Separate task status and payload | Retain Coreza's existing public envelope for compatibility |
| Explicit output-port structure | Preserve Coreza routing/control; do not infer routing from display formatting |
| Invocation provenance | Preserve current invocation/iteration identity |
| Existing workflow engine model | Preserve Coreza input, loops, expressions and VM semantics |
| Provider payload handling | Avoid implicit wrapping or guessing envelope fields |
| Document metadata | Keep document payloads intact; a general binary storage redesign is separate |

## 5. Proposed contract

Put the initial shared source under:

`coreza-backend/src/contracts/nodeResult.ts`

Reason: the backend currently has `rootDir: "./src"`, and the frontend already imports browser-safe backend logic. A new root-level package would require coordinated backend build changes. Start with one portable source inside the backend compilation root and frontend facades, then consider extracting a package later.

The module must have no Axios, Express, React, database, Redis, Node-only imports, environment access, or I/O.

Illustrative contract, to finalize in phase 1:

```ts
type ResultStatus =
  | "pending" | "running"
  | "success" | "error"
  | "waiting" | "listening" | "streaming"
  | "skipped" | "cancelled" | "not-executed";

interface NodeResult<T = unknown> {
  status: ResultStatus;
  data: T | null;
  error?: string;
  details?: ResultErrorDetails;
  meta?: ResultMeta;
  control?: RuntimeControl; // engine-only extension
}
```

Use the same envelope for every node. `data` always exists, including null for a state with no payload. Domain payloads may be objects, arrays, strings, numbers, booleans, or null. Preserve zero, false, empty string, empty array, and explicit null without truthiness or nullish-fallback reinterpretation.

Keep error as a string to preserve current consumers. Details carries typed code, provider, HTTP status, recoverable, and permitted response information. Use an explicit safe-field policy for diagnostic response data. Do not serialize arbitrary Error/Axios/config objects.

Metadata should have named fields for timestamp, duration, node/run/invocation identity, cache information, indicator readiness, and persistentVariableKeys, plus a deliberate extension policy. Preserve existing metadata during migration, including series and requiredBars where used; do not casually expose large series in every transport. Split transport omission from runtime preservation.

`RuntimeControl` should be structurally typed in a browser-safe contract source. Avoid a circular runtime import into executors. Existing public types can re-export it.

### Shared API

| API | Responsibility |
| --- | --- |
| `resultSuccess(data, options?)` | Explicitly treat all supplied data as payload |
| `resultFailure(message, options?)` | Construct error state with safe structured diagnostics and optional partial data |
| `resultState(status, data, options?)` | Construct listening, waiting, skipped, cancelled, etc. |
| `isNodeResult(value)` | Validate the status/data contract at a known result boundary; never infer an envelope from arbitrary domain data |
| `decodeLegacyNodeResult(value, sourceKind)` | Read known old formats at ingress/history boundaries only |
| `finalizeNodeResult(result, context, profile)` | Add available execution metadata once, without changing payload/control |
| `toPublicNodeResult(result, options)` | Project engine control and transport-only internals out explicitly |
| `getNodePayload(result)` | Typed data access; no recursive unwrapping |
| `getNodeDiagnostic(result)` | One error view for UI/logging and workflow failure handling |

New executors must use explicit constructors, not the compatibility decoder. `resultSuccess({success:false, status:"open", data:[...]})` must preserve that entire object as domain data.

Make canonical recognition idempotent: a fully finalized canonical result returns unchanged when no metadata needs adding. Do not read the clock to check an already finalized result. Keep payload reference identity; no deep clone/freeze/stringify of data in constructors.

### One status field; no success boolean or formatVersion

The canonical envelope has one lifecycle field: `status`. Do not add `success` or `formatVersion`. `status: "success"` identifies successful execution; `error`, `cancelled`, `running`, `waiting`, and the other states retain their separate meanings. This prevents contradictory pairs such as `success: true` with `status: "error"`.

Shared predicates such as `isFailedResult(result)` and `isCompletedResult(result)` derive their answers from status. Do not persist another success flag. An error is not the same as cancellation, and a non-error state is not automatically a completed execution or a new data event.

Legacy ingress adapters may read the old success boolean to derive status when the source lacks an explicit lifecycle status. Define precedence for known old formats and flag contradictory legacy states; explicit error/failure cannot be converted to success. Remove the old boolean from the decoded canonical envelope. Keep any temporary old-consumer response adapter at a named transport boundary only.

Because the envelope has no version marker, do not use shape matching to reinterpret arbitrary payload objects. Validate only at known result boundaries with an explicit source kind. A payload may itself contain status and data keys, so a shape guard is not proof that the object is an envelope.

Audit every `result.success`, `!result.success`, `success === false`, and `success !== false` consumer before enabling status-only writers. This includes classic runtime, compiled VM/adapters, AI tool execution, HTTP error decisions, frontend publication, OutputPanel guards, pinned outputs, history, and run serialization. Preserve the old behavior intentionally with status predicates and characterization fixtures; do not replace these checks with a universal `status !== "error"` condition.

Keep existing scheduling decisions unchanged initially. Waiting/listening acknowledgements must retain existing routing policy, and any later scheduler policy change requires separate characterization tests. Do not introduce a new status-based routing gate incidentally while replacing helpers.

Map listener timeout/expired outputs to `status:"error"` with a stable details code/reason, preserving their message and useful payload. Keep cancelled distinct from failed. Retain warmup suppression as an explicit typed signal until all consumers are migrated; do not convert a valid indicator-not-ready state into an execution error.

### Example: identical outer format, different payload

```json
{
  "status": "success",
  "data": {"value": 62.4, "IsReady": true}
}
```

```json
{
  "status": "success",
  "data": {"emitted": false, "timeframe": "4h"}
}
```

Payload examples are illustrative, not a proposal to rename actual indicator fields. A real Consolidator retains its complete payload; a broker retains its operation-specific data.

Existing paths remain stable:

- `$("get_atr_history").json.data.value`
- `$("Consolidator").json.data.emitted`
- `$("bars").json.data.current_bar.close`
- computed slices over the original array payload
- `$vars` remains its separate read-only scalar namespace

Do not add a stored `json` layer around every result. Coreza's expression resolver supplies that selector behavior already.

## 6. Boundary architecture

1. Domain service computes its own data or typed failure.
2. Executor calls the shared constructor and returns a canonical runtime result.
3. Classic runtime, compiled adapter, and AI tool invocation validate/decode only where needed, retaining control and diagnostics.
4. Runtime stores the same canonical result. Avoid normalize -> legacy conversion -> normalize.
5. HTTP/history/WebSocket publication uses the shared public serializer.
6. Editor ingress accepts canonical results or explicitly decodes legacy responses once.
7. One guarded frontend publisher writes the same result reference to relevant runtime views and sends one notification.
8. Panels/selectors read stable results and derive presentation without changing execution metadata.

A result builder is a pure utility, not a new network service or queued job. There should be no extra await or I/O on a synchronous node path.

Retain separate, typed transport wrappers for agentActivity, variableSnapshot, run IDs, pagination and subscription delivery information. Do not put the variable registry into output.data or normalize an entire workflow_runs response as one node result.

## 7. Migration by node family

| Family / implementation | Required result work | Behavior to preserve |
| --- | --- | --- |
| IndicatorsExecutor | Convert normal, sync, readiness and rolling-window paths to shared constructors | IsReady, sample counts, prior/current values, requiredBars, smoothing/series, O(1) state |
| InitializeIndicatorsExecutor | Remove lossy normalize/toNodeResult round trips | warmup cache, initialization metadata and async readiness |
| BrokerExecutor | Convert validation/cached/success/auth/generic-error branches | code/provider/recoverable, cached, order idempotency and operation payload |
| DataSourceExecutor | Explicit payload vs envelope adapters for provider and Store/Redis results | Store state, news/data arrays, cache behavior; preserve provider siblings |
| ConsolidatorExecutor | Shared success/failure with stable error codes | data.emitted, bar/timeframe fields, state ownership |
| ControlFlowExecutor | Shared results for If, Switch, Compute, Edit Fields, and Loop adapters | existing booleans/labels, typed values, Persistent commit ordering |
| LoopExecutorV2 | Explicit V2-to-canonical adapter before tightening interface | all batches, iteration context, parallel work, done/body routing |
| PortfolioExecutor | Migrate returns while leaving broker/trading computation intact | fills, pending orders, ownership, portfolio MTM and operation statuses |
| BacktestExecutor | Standardize public node results and simulation boundaries | OnBar payload, warmup, session ownership and compiled/classic parity |
| RiskExecutor | Shared constructors preserving payload units | current sizing/stop-distance/margin semantics |
| CommunicationExecutor | Preserve service envelope through explicit adapter | provider delivery data and diagnostics |
| DocumentExecutor | Shared helpers without status/details loss | text/document metadata and size limits |
| ToolExecutor | Shared result before agent projection | web search/OpenAI tool-specific payloads |
| TriggerExecutor | Explicit listener state and acknowledgement payload | channels/callback URL/subscription data, stop/recovery behavior |
| IOExecutor | Shared ChatInput results | typed text/input and node identity |
| UtilityExecutor | Shared HTTP/test utility results | domain HTTP status inside payload, request behavior |
| Stream/Scheduler routes and frontend listeners | Shared public event/ack construction at editor boundary | market event shape, cursor/recovery, stop, timeout |
| Visualize/frontend-local actions | Shared result publisher; preserve existing data schema | chart/reference payload and local execution guards |
| ChatModel and Memory attachments | Configuration/readiness UI state only unless actually invoked | no fabricated market/workflow output; do not execute subnodes simply to fill a result |

Do not derive executor mapping from category text alone. Inventory shows, for example, Consolidator/Data, RollingWindow/Data, Risk Engine/Risk Management, and ChatInput/Input. Resolve through existing mapping and execution action definitions.

All 73 definitions are listed in the appendix. Phase 0 must produce node type + operation + execution-mode coverage, including nodes invoked as AI tools. One happy-path fixture per category is insufficient.

## 8. Performance and memory design

- The required status field has a small constant envelope cost; measure it. Remove redundant success bookkeeping.
- Keep `resultSuccess` synchronous and allocation-bounded. Do not make syncCapable nodes async.
- Prefer one final envelope allocation. Do not construct StandardNodeOutput and immediately convert it.
- Metadata profile `hot` omits optional timestamp/duration/identity allocation per node per bar. `observed` adds captured execution identity and timing at requested publication boundaries. Both use the same schema.
- Clock ownership belongs to the invocation/publication context. If per-node execution time was not captured, omit it; do not fabricate it from later serialization.
- Public serialization is copy-on-write for the outer envelope only. No mandatory payload scan on every tick.
- Preserve immutable ownership conventions; do not freeze every candle or copy full series in this generic helper.
- Validate large payload serializability and apply size limits at actual transport/persistence boundaries. Serialization must define behavior for undefined, non-finite numbers, BigInt, dates, cycles and class instances; failures become a clear boundary diagnostic rather than silent corruption.
- Do not auto-expand dataRef values, add per-tick database writes, or introduce per-mutation queues.
- Keep live retention bounded by existing policy. Storing every historical invocation is a separate feature.
- In React, publish a new result only when an invocation/state actually changes. Rendering and tab changes do not normalize the result again.

Benchmark classic and compiled paths with scalar nodes, indicator state, Consolidator, and large historical arrays. Compare the same fixtures before/after for wall time, allocated bytes/heap behavior, event-loop delay and output serialization. A provisional release gate is no material throughput regression (target <=5% median overhead on repeated controlled runs); investigate any sustained memory increase. This is an engineering gate, not a promised speedup.

## 9. Phased implementation plan

### Phase 0: complete call-site inventory and capture compatibility

Deliverables:

- Inventory every definition, operation, manual endpoint, executor, local action, listener producer, AI-tool entry, run store and history serializer.
- Find all calls to normalizeOutput/create*Output/toNodeResult, direct result literals, res.json, output publications, and status heuristics. Classify rather than mechanically replacing unrelated HTTP APIs.
- Capture current payload/routing fixtures for supported execution modes and selected stored history versions.
- Record exact expression paths used in existing templates and fixtures.
- Establish baseline classic/compiled and UI publication measurements.

Gate: no executable node family lacks an owner/entry in the matrix. Configuration attachments are explicitly marked.

### Phase 1: shared contract and lossless facades

Deliverables:

- New portable contract/helpers discriminated by status, with typed metadata/errors/control and no success boolean or formatVersion field.
- Frontend/backend existing type and normalizer files become thin re-export/adaptation facades.
- Keep Axios-specific error extraction in a server adapter outside the shared module.
- Define explicit legacy source kinds (executor, manual endpoint, history, pin, listener) and finite adapters.
- Add new status support consistently; preserve payload-key collisions.
- Remove context-ignoring success construction behavior without reintroducing mandatory hot-path timing.

Gate: pure shared module compiles in both environments and preserves round-trip fields/reference identity.

### Phase 2: runtime and executor convergence

Deliverables:

- Change NodeResult/INodeExecutor typing with a temporary legacy union only during migration.
- Migrate success-boolean consumers in classic runtime, compiled VM/adapters, AI tools and publication to explicit status predicates before enabling status-only results.
- Migrate all 17 executor files plus BacktestExecutor and direct/local producers in small node-family batches.
- Preserve error objects/details through classic failure handling; if throwing is required, throw a typed result-carrying runtime error.
- Keep owned child snapshots on parent failure.
- Migrate compiled adapters without adding awaits to synchronous instructions.
- Replace LoopV2 conversion with one explicit lossless adapter.
- Stop converting canonical results back into incomplete legacy results.

Gate: classic/compiled routing, full-loop execution, warmup and fail-fast semantics match baseline.

### Phase 3: API, streaming, history, and AI integration

Deliverables:

- Apply public serialization to actual node-result endpoints, run nodeResults, and editor event publications.
- For routes bypassing executors, call shared constructors after their existing domain service logic. Do not reroute indicator/variable execution through a different path just to reuse formatting.
- Standardize subscription acknowledgement vs delivered-event envelopes.
- Keep cursor/registration/control transport fields in explicit wrappers/adapters.
- Preserve original result for AI activity/debugging, then generate the bounded LLM projection.
- Centralize history decoding; read old rows without rewriting them.
- Verify cancellation and structured auth diagnostics across all boundaries.

Gate: the same fixture's data/status/error survives manual endpoint, stored history and tool invocation; expected LLM summaries remain compact.

### Phase 4: frontend publication and rendering

Deliverables:

- One guarded publisher used by normal completion, required-field failure, action failure, local actions and listeners.
- Keep the execution/session guard, pins, override precedence, variable snapshot separation and one-notification requirement.
- Make useNodeOutput, InputPanel and OutputPanel read canonical or explicitly decoded legacy results.
- Show status and structured diagnostics consistently; useful error details must be accessible without inserting them into business data.
- Preserve drag-generated paths, previews, nested slices, and the typed evaluator's identity snapshots.
- Keep model/memory configuration attachments from appearing as successful executable data nodes.
- History panel selection remains stable while reading a fixed result.

Gate: no new rendering loop/blink on opening output/history panels; unchanged results retain reference identity through selectors.

### Phase 5: enforce and simplify

Deliverables:

- Remove permanent frontend/backend normalization duplication.
- Remove broad raw-result unions after all producers migrate.
- Add a targeted repository check for result literals/legacy constructor imports outside adapters and tests, with explicit exemptions for domain/provider payloads.
- Generate coverage tests from the manifest and actual execution mapping.
- Enable canonical writing only after compatible readers are deployed.
- Keep legacy readers for saved history/pins/imports; retire them only with a documented compatibility policy.

Gate: new nodes can implement domain logic and one shared constructor without implementing their own envelope/status/error formatter.

## 10. Validation and release gates

### Contract tests

- Canonical envelope has status/data and no success or formatVersion fields.
- Legacy success-only results decode to the expected lifecycle state; contradictory legacy inputs have defined handling.
- Pending/running/listening/waiting/skipped/cancelled are not confused with completed success by runtime or UI checks.
- Object/array/scalar/null, including false/zero/empty string.
- Payload containing data/success/status/error/json keys is preserved intact.
- Canonical construction/decode/finalize is idempotent.
- No data.data or json.json appears through repeated conversion.
- Listening/waiting/streaming/skipped/cancelled/not-executed all survive.
- Timeout/expired have explicit error codes.
- Structured HTTP/auth/provider errors retain allowed fields, without raw credential-bearing request objects.
- Metadata/control survive runtime conversion; public serializer deliberately excludes engine internals.
- Partial failure data, warmupSuppressed and persistentVariableKeys survive.
- Old history timestamps remain unchanged; missing timestamps stay missing.
- Serializability failures are deterministic at the boundary.
- Promise guards and sync return behavior are unchanged.

### Execution tests

| Scenario | Required assertion |
| --- | --- |
| Single manual node and cluster action | same canonical envelope, correct pin/override precedence |
| Execute All fails mid-graph | current fail-fast policy and detailed output preserved |
| If and Switch | exact same downstream branch activation and payload |
| Loop sequential, parallel, nested/owned session | all iterations; correct done routing; child snapshots retained on error |
| Consolidator partial/completed interval | emitted=false is successful data; correct bar/timeframe fields |
| Classic vs compiled backtest | equivalent payload/control/error outcomes for the same strategy fixtures |
| Live market event | unchanged event routing, bounded RAM and variable behavior |
| Indicator warmup/readiness | no zero/false/null reinterpretation; AI readiness remains distinct |
| Broker order/cache/auth error | no duplicate order; diagnostic code/provider/recoverable retained |
| Persistent Edit Fields | commit before publish; no registry leakage; live RAM/write-behind rules retained |
| Subscription timeout/stop/recovery | no false success; cancellation/expired handling clear |
| Agent historical/indicator/screener tool | canonical result preserved; bounded summary/dataRef still correct |
| History/input/output panels | stable display, original status, structured details, no read-time mutation |

Browser integration checks should exercise normal and clustered nodes, collapsed runtime hosts, history viewing, output field drag/drop, typed expressions and nested slices. Use existing test infrastructure and fixtures rather than attempting real trades.

### Rollout and rollback

1. Ship readers/decoders supporting both legacy and status-only outputs.
2. Introduce shared producer changes by family on dev; run parity fixtures and benchmarks.
3. Verify representative manual/history/live/backtest flows before enabling all canonical writers.
4. Preserve legacy stored outputs and graph documents; no bulk rewrite is required.
5. Roll back producer enablement while retaining compatible readers. Do not revert structured diagnostic/security filtering or variable ownership guards.
6. Document supported legacy shapes and adapter provenance alongside the saved run format. Do not add a result version field or classify arbitrary provider data as an envelope.

## 11. Suggested implementation slices

1. Shared contract + payload collision/error/control/status tests + old import facades.
2. Classic runtime + compiled adapter + LoopV2 lossless conversion.
3. Pure/control/indicator/Consolidator executors and direct indicator endpoints.
4. Provider/broker/portfolio/storage/document/communication executors and HTTP serializers.
5. Listener/stream/local action publishers + AI projection boundary.
6. History/panels/reference parity + coverage enforcement + performance evidence.

Each slice targets dev and includes its relevant tests. Do not bundle a scheduler rewrite, broker schema redesign, or React state-store rewrite into this migration.

## 12. Completion checklist

- [ ] One portable shared implementation; old files are facades only.
- [ ] All 73 definitions classified; executable operations have canonical producers.
- [ ] No lossy toNodeResult round trip remains.
- [ ] Required status/data exist; canonical outputs have no success or formatVersion fields.
- [ ] All legacy success checks are migrated to explicit status predicates before status-only writing.
- [ ] Payload shapes and expression paths remain compatible.
- [ ] Status, diagnostics, metadata, warmup and control survive the necessary boundaries.
- [ ] Configuration attachments are handled explicitly.
- [ ] Runtime result, public result and LLM projection have documented boundaries.
- [ ] Old saved history and pinned/imported output remain readable.
- [ ] Loop, branching, order safety and variable persistence parity pass.
- [ ] UI stability and controlled classic/compiled performance gates pass.
- [ ] Runtime rollout occurs after compatible readers.

## Appendix A: complete node-definition inventory

The categories below are definition categories, not a claim about executor registry routing.

- **Indicators (13):** ADX, ATR, BB, EMA, Ichimoku, InitializeIndicators, MACD, OBV, RSI, Stoch, SupportResistance, VWAP, VolumeOscillator.
- **AIAgent (1):** AIAgent.
- **Broker (5):** Alpaca, Binance, Dhan, FinnHub, Schwab.
- **Screener (5):** AlpacaScreener, BinanceScreener, FMPScreener, SchwabScreener, YahooFinanceScreener.
- **Stream (8):** AlpacaStreamData, AlpacaSubscribe, BinanceStreamData, BinanceSubscribe, DhanStreamData, DhanSubscribe, SchwabStreamData, SchwabSubscribe.
- **Backtest (5):** BacktestInit, BacktestPortfolio, BacktestResults, BacktestTrade, OnBar.
- **Input (1):** ChatInput.
- **Logic (5):** Compute, Field, If, Loop, Switch.
- **Data (12):** Consolidator, FMP, FMPNews, HttpRequest, InMemory, Market, Polygon, RedisStore, RedisTrigger, RollingWindow, Store, YahooFinance.
- **Document (1):** DocumentExtract.
- **ChatModel (2):** GeminiChatModel, OpenAIChatModel.
- **Communication (3):** Gmail, Telegram, WhatsApp.
- **Trigger (2):** GmailTrigger, TelegramTrigger.
- **Tool (1):** GoogleWebSearch.
- **LLM (1):** OpenAI.
- **Portfolio (1):** Portfolio.
- **Memory (3):** PostgresChatMemory, RedisChatMemory, SimpleMemory.
- **Risk Management (1):** RiskEngine.
- **Scheduler (1):** Scheduler.
- **Visualization (1):** Visualize.
- **webhook (1):** WebhookTrigger.

## Appendix B: Coreza evidence links

All links are pinned to the reviewed dev snapshot.

- [AGENTS.md](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/AGENTS.md)
- [src/types/nodeOutput.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/types/nodeOutput.ts)
- [coreza-backend/src/types/nodeOutput.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/types/nodeOutput.ts)
- [src/utils/normalizeOutput.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/utils/normalizeOutput.ts)
- [coreza-backend/src/utils/normalizeOutput.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/utils/normalizeOutput.ts)
- [coreza-backend/src/nodes/types.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/types.ts)
- [coreza-backend/src/nodes/categoryMap.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/categoryMap.ts)
- [coreza-backend/src/engine/executionRuntime.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/engine/executionRuntime.ts)
- [coreza-backend/src/backtest/compiled/adapters.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/backtest/compiled/adapters.ts)
- [coreza-backend/src/backtest/compiled/vm.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/backtest/compiled/vm.ts)
- [coreza-backend/src/nodes/executors/TriggerExecutor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/executors/TriggerExecutor.ts)
- [coreza-backend/src/nodes/executors/BrokerExecutor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/executors/BrokerExecutor.ts)
- [coreza-backend/src/nodes/executors/ControlFlowExecutor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/executors/ControlFlowExecutor.ts)
- [coreza-backend/src/nodes/executors/ConsolidatorExecutor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/executors/ConsolidatorExecutor.ts)
- [coreza-backend/src/nodes/executors/AIAgentExecutor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/executors/AIAgentExecutor.ts)
- [coreza-backend/src/nodes/logic/toolOutputProcessor.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/nodes/logic/toolOutputProcessor.ts)
- [coreza-backend/src/routes/indicators.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/routes/indicators.ts)
- [coreza-backend/src/routes/broker.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/src/routes/broker.ts)
- [src/hooks/useNodeExecution.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/hooks/useNodeExecution.ts)
- [src/hooks/useListeningConfigs.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/hooks/useListeningConfigs.ts)
- [src/hooks/useListeningHandler.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/hooks/useListeningHandler.ts)
- [src/utils/persistedNodeResult.ts](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/utils/persistedNodeResult.ts)
- [src/utils/OutputPanel.tsx](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/src/utils/OutputPanel.tsx)
- [coreza-backend/tsconfig.json](https://github.com/Coreza-io/coreza/blob/2844aa991344dc5262fdb05289ac5fe3e79fc8b4/coreza-backend/tsconfig.json)
