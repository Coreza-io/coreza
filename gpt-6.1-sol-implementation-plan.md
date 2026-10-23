# GPT-6.1 Sol integration plan

Status: planning only; no runtime implementation.
Revision: integration planning updated on 20 October 2026 (India time).
Target: `Coreza-io/coreza`, `dev` branch only.
Reviewed baseline: `3f7a98232ff26a5ea1b75c9c03986faf7f06d9a1`.
Model in supplied screenshot: **GPT-6.1 Sol**.
Exact API model ID: `gpt-6.1-sol`.

## 1. Goal and scope

Add GPT-6.1 Sol as an optional OpenAI Chat Model for workflow AI Agents, with working connected tools, reasoning selection, memory, cancellation, activity events, and final output across manual, Execute All, backtest, and live execution.

Keep existing saved model selections and the current `gpt-5.4-mini` default. Do not change the separate legacy OpenAI node or AgentSystem assistant defaults. Do not rewrite prompts, broker routing, indicator algorithms, workflow scheduling, or tool logging as part of this integration. Better model reasoning does not replace correct data validation or tool contracts.

The screenshot's effort selector establishes the desired model and configurable reasoning; reproducing its slider design is unnecessary. Coreza's existing select control can expose the supported values.

## 2. Verified OpenAI requirements

Official model documentation, checked 20 October 2026 (India time):
https://developers.openai.com/api/docs/models/gpt-6.1-sol

- Use exact ID `gpt-6.1-sol`.
- Supported reasoning efforts: `low`, `medium`, `high`, `xhigh`, `max`; default `medium`.
- `none` and `minimal` are unsupported.
- Tool calling requires the **Responses API**. Chat Completions supports this model only without tool calling.
- Standard integration does not require Fast/Ultrafast modes. Keep service-tier configuration out of the initial change.

Do not infer API access from the model appearing in ChatGPT Work. Validate access using the configured OpenAI project during the implementation smoke test.

## 3. Current implementation and concrete gaps

| File | Observed behavior | Required change |
| --- | --- | --- |
| `src/nodes/OpenAIChatModel.json` | Picker stops at existing GPT-5/GPT-4 options; reasoning options lack max and include none. | Add exact model and model-specific efforts. |
| `coreza-backend/src/config/llmProviders.ts` | Constructs ChatOpenAI, passes reasoning_effort through modelKwargs, does not explicitly select Responses; ReasoningEffort union lacks max. | Resolve capabilities, select Responses for Sol, normalize parameters through the installed SDK. |
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | Reads supportsReasoning/isSearchModel from saved node values; passes model/effort to factory and runs createAgent with connected tools. | Derive Sol capabilities from trusted model identity, preserving the existing agent/tool lifecycle. |
| `src/components/nodes/layout/components/NodeFieldRenderer.tsx` | Already supports dynamicOptions.optionsByValue and conditionalOptions for selects. | Reuse the existing mechanism for effort choices. |
| `src/hooks/useNodeFieldState.ts` | Dynamic dependent fields reset to the first option when their parent changes; canonical writes have execution/session guards. | Ensure a model switch preserves valid efforts and defaults invalid efforts to medium, atomically. |
| `coreza-backend/src/nodes/nodeDefinitions.ts` | Loads frontend JSON definitions with a process cache. | Reuse model option metadata if practical; account for deployment paths and restart/cache behavior. |
| `coreza-backend/package.json`, lockfile | @langchain/openai 1.2.4, langchain 1.2.16, @langchain/core 1.1.18 are locked. | Verify actual installed Responses support before deciding whether any dependency change is necessary. |

The root lock entry for openai is 4.104.0 while @langchain/openai declares a ^6.16.0 dependency. Inspect nested lock entries and actual module resolution; the root SDK version alone does not establish the version used by LangChain.

No guarantee currently exists in the reviewed field-state hook that option metadata such as supportsReasoning is copied into persisted values. Backend behavior must not depend on the editor having opened or on a client-provided capability boolean.


## 3A. Integration decisions

Keep model discovery separate from capabilities. Listing a model does not establish that its parameters or agent tool loop work. The initial integration should use a small endpoint-aware factory change with model-specific validation and the existing agent loop.

- Select the required Responses route explicitly for this model without changing defaults for legacy models.
- Use the documented Responses reasoning format and expose the model's supported efforts.
- Preserve intermediate message/tool metadata and normalize only the final user-facing output.
- Keep broker and indicator nodes as local function tools; hosted provider tools are outside this change.
- Verify the resolved adapter before changing dependencies. Avoid unrelated SDK upgrades or patches.

### Concrete transport shape to verify

Verify this transport shape against Coreza's resolved adapter:

```ts
new ChatOpenAI({
  apiKey,
  model: "gpt-6.1-sol",
  useResponsesApi: true,
  modelKwargs: { reasoning: { effort: resolvedEffort } },
  // Existing token limit goes through the adapter's verified Responses mapping.
});
```

Use either a supported typed reasoning property or the verified nested modelKwargs mapping, not both. Do not also emit legacy reasoning_effort. Keep model/endpoint/effort authority outside arbitrary client overrides.

### Bounded follow-up: dynamic model discovery

This is a separate small enhancement after the Sol request/tool acceptance checks pass; it is not required to prove this model works.

- Extend the authenticated model routes (for example, GET `/models/openaichatmodel/models?credential_id=...`) to retrieve credentials server-side for the authenticated owner and call the fixed official OpenAI /v1/models endpoint.
- Return model IDs/labels only, with searchable results and conservative family filtering. Never send an API key to the browser or accept a browser-supplied arbitrary base URL.
- Reuse the existing dependent-API select infrastructure. Retain the saved model ID even if listing fails or temporarily omits it; never switch a workflow automatically.
- Retain curated options as a usable fallback with an explicit discovery-error state. Avoid a network fetch on every keystroke or tick; any cache must be short-lived and isolated by user and credential, and cleared when credentials change.
- Keep discovery separate from a narrow shared capability map. /models supplies IDs, not complete endpoint/effort/temperature/tool capabilities. Do not infer that every discovered gpt-* model supports tools or accepts GPT-6.1 Sol's settings.
- A direct-ID option may be added only with existing validation/error behavior. An unknown ID must not automatically inherit Sol capabilities.
- Test account isolation, credential changes, empty/failed lists, saved IDs, filtering, and absence of provider calls on the workflow hot path.

## 4. Implementation sequence

### Step A — Prove SDK compatibility before exposing the model

1. Install from the existing backend lockfile in the implementation checkout.
2. Inspect the resolved @langchain/openai constructor/types and its resolved OpenAI SDK.
3. Verify the supported way to force Responses, configure reasoning, limit output tokens, and disable provider response storage where supported.
4. Prefer the existing ChatOpenAI adapter and createAgent integration. Verify useResponsesApi: true and its request behavior in Coreza's resolved adapter. Start with the small transport shape in section 3A.
5. Capture a mocked outgoing request for one model invocation and one complete tool round trip. Test both invoke and stream paths where Coreza actually uses them; the proposed transport configuration does not itself prove these paths work for Sol.
6. Require the actual request to target `/v1/responses`, use `model: "gpt-6.1-sol"`, and serialize `reasoning: { effort: "medium" }`.
7. Verify tool call IDs, tool result IDs, reasoning items, and continuation messages survive a second model turn.

If the locked adapter cannot meet these requirements, make the smallest compatible dependency upgrade and update the backend lockfile together. Re-run existing model regression checks. Do not add a custom agent loop or migrate every OpenAI model to Responses.

### Step B — Resolve capabilities from model identity

Add a narrow capability resolver used by the factory/agent configuration boundary. Prefer one small shared model-capability module consumable by backend and UI; the current static option definition can supply it only if its production loading is reliable. Keep capability facts independent of provider-discovered IDs, and avoid designing a broad provider framework.

For Sol, resolve:
- reasoning enabled;
- allowed efforts low/medium/high/xhigh/max;
- default medium;
- Responses required;
- temperature omitted in the initial integration.

Derive these from exact provider/model identity, independently of saved flags. Keep legacy flags as compatibility inputs for existing models; do not globally reclassify them or accept client flags that disable Sol's required endpoint.

Missing effort becomes medium. An explicit unsupported effort in a headless/imported execution should produce a clear configuration error before any provider call. The editor should proactively repair stale effort during a user model switch. This separates a predictable UI transition from silent server coercion.

Extend ReasoningEffort to include max, with per-model validation so other models do not accidentally gain unsupported efforts.

### Step C — Add picker and effort configuration

In OpenAIChatModel.json:
1. Add label GPT-6.1 Sol, value gpt-6.1-sol, and reasoning capability metadata consistent with the chosen resolver.
2. Include Sol in reasoning field visibility.
3. Expose exactly low/medium/high/xhigh/max for Sol.
4. Reuse dynamic or conditional select options; retain existing options for every other model.
5. Update the reasoning description to cover supported models, rather than only GPT-5.
6. Keep temperature hidden for Sol and preserve current model defaults.

On explicit model changes, preserve an effort when valid for the destination; otherwise use that model's default. Selecting Sol after none must select medium, not the first array entry low. Switching away from Sol with max must also normalize against the destination's allowed values.

Use a single guarded canonical batch update for model plus any changed effort. Preserve execution locks, undo/redo, session guards, and read-only behavior. If the generic dynamic reset must change, make it opt-in or verify existing dependent selects remain unchanged.

### Step D — Wire agent configuration and API request normalization

Continue using getLLM and createAgent. Resolve model capabilities before building LLMConfig; forward the resolved effort, required endpoint, and token budget to the factory.

For Sol:
- force Responses for both text-only and tool-bearing invocations;
- serialize reasoning in the Responses request format using supported SDK properties;
- do not leak Chat Completions reasoning_effort into the final Responses JSON;
- map the existing maxTokens setting to the adapter's Responses output-token limit;
- validate a finite positive integer token budget against documented limits;
- avoid duplicate/conflicting parameters in modelKwargs;
- ensure stale temperature in saved workflow values cannot reach the provider.

Keep existing token-budget settings initially. A small budget may be exhausted by reasoning before final text; surface an incomplete/token-limit outcome clearly rather than reporting empty success. Do not silently increase every workflow's budget.

Do not use provider previous_response_id or shared remote conversations to replace Coreza's workflow-scoped memory. Verify local message replay and storage settings with the selected adapter.

### Step E — Preserve output, memory, activity, and failure behavior

Validate getAgentOutput against real/mocked Responses message shapes. Return final assistant text, not serialized reasoning blocks or function-call metadata. Patch extraction only if a compatibility test exposes a gap; avoid broad output refactoring. Leave intermediate model messages intact so reasoning items, response metadata, and tool call associations survive continuation.

Keep:
- connected DynamicStructuredTool executors and their dataRef handoffs;
- history read/write, conversation locking, and user/workflow ownership;
- model/tool activity span identity and editor highlighting;
- AbortSignal propagation and terminal cleanup;
- existing error normalization and redaction.

An unavailable model, authentication error, unsupported configuration, rate limit, or incomplete response must produce an actionable error. Do not silently substitute another model. Do not replay an entire agent invocation after a tool side effect; retain existing bounded transport behavior and test cancellation/error paths.

## 5. Validation and acceptance criteria

### Automated checks

1. **Request contract:** intercept the SDK transport and assert Responses endpoint, exact model, supported nested reasoning, output limit, and absence of incompatible parameters.
2. **Capability validation:** absent effort defaults to medium; all five allowed efforts accepted; none/minimal/unknown rejected before network I/O; stale supportsReasoning=false cannot bypass Sol requirements.
3. **Editor transitions:** valid effort preserved, none-to-Sol becomes medium, max-to-other-model normalized, save/reload/import/undo work, execution locks prevent changes.
4. **Agent round trip:** mocked historical-data tool → exact dataRef → indicator tool → final text. Confirm second model request contains correctly associated tool results and reasoning/continuation items required by the SDK.
5. **Final output:** text/content-block variants yield text; reasoning/tool-only or incomplete responses do not become misleading final success.
6. **Memory and lifecycle:** follow-up invocation retains intended history, cancellation drains active tools, locks/context references release, activity spans close exactly once.
7. **Compatibility:** representative existing reasoning model, standard GPT-4 model, and Gemini retain their current request paths and configuration.
8. **Mode coverage:** trace each entry point to AIAgentExecutor and run focused manual/Execute All/backtest/live checks with deterministic market-data fixtures and mocked model transport.

Run node-definition validation and frontend/backend builds using existing scripts. Use the repository's actual test setup for new focused tests. Do not require live broker orders or paid provider calls for the default automated suite.

### Controlled provider smoke test

With configured project access, explicitly select GPT-6.1 Sol in a test workflow. Run a text-only request, a read-only tool round trip, and a memory follow-up. Use standard service tier and bounded tokens. Confirm model ID, endpoint, effort, activity events, final output, elapsed time, and usage; never log API keys or raw private prompts.

A stronger model must not be claimed to fix the historical-data/indicator issue until the tool chain succeeds and readiness/dataRef evidence is correct. Compare medium and high on the same task if quality remains uncertain.

## 6. Delivery and rollback

Implement in small commits: request/capability boundary, picker/effort state, then compatibility tests. Track dynamic model discovery separately after the core Sol acceptance criteria pass. Gate completion on a working tool round trip, not merely seeing the model in the dropdown.

Roll out as an optional picker choice. Existing workflows keep their selections. Deploy compatible backend request handling before users can save newly authored Sol configurations.

Rollback by stopping new Sol selection while retaining recognition of saved model IDs and clear execution diagnostics. Revert the narrow transport/capability changes if necessary; do not silently rewrite saved workflows to another model.

## 7. Definition of done

- GPT-6.1 Sol selectable and persisted with correct effort choices.
- Sol's agent tool requests demonstrably use Responses.
- Backend enforces model-specific capabilities without trusting saved UI flags.
- All existing execution modes preserve output, memory, activity, and cancellation.
- Unsupported settings fail clearly, with no model substitution.
- Existing models/defaults continue unchanged.
- Focused tests and builds pass; live API smoke-test status is recorded separately.
