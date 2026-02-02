
# Plan: Make AI Agent Generic for Any LLM Provider

## Problem Analysis

The current `AIAgentExecutor` is **tightly coupled to OpenAI**:

| Issue | Location | Problem |
|-------|----------|---------|
| Hardcoded import | Line 18 | `import { ChatOpenAI } from "@langchain/openai"` |
| Hardcoded credential type | Line 129 | `CredentialManager.getCredentials(user_id, "openaichatmodel", ...)` |
| Hardcoded LLM initialization | Line 203 | `new ChatOpenAI(llmConfig)` |
| OpenAI-specific model detection | Line 194-200 | `isSearchModel()` only for OpenAI |

Adding Gemini, Anthropic, or any new provider would require modifying `AIAgentExecutor.ts` code.

---

## Proposed Architecture

```text
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (JSON)                         │
├────────────────────────────────────────────────────────────────┤
│  OpenAIChatModel.json     GeminiChatModel.json     Future...   │
│  - category: "ChatModel"  - category: "ChatModel"              │
│  - provider: "openai"     - provider: "gemini"                 │
│  - model options          - model options                      │
│  - auth fields            - auth fields                        │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                  Backend LLM Provider Registry                 │
├────────────────────────────────────────────────────────────────┤
│  llmProviders.ts                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ openai: {                                                │  │
│  │   createModel: (apiKey, config) => new ChatOpenAI(...)   │  │
│  │   searchModels: ["gpt-4o-search-preview", ...]           │  │
│  │   defaultModel: "gpt-4o-mini"                            │  │
│  │ }                                                        │  │
│  │ gemini: {                                                │  │
│  │   createModel: (apiKey, config) => new ChatGoogleGenAI() │  │
│  │   defaultModel: "gemini-pro"                             │  │
│  │ }                                                        │  │
│  │ anthropic: { ... }                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                     AIAgentExecutor.ts                         │
├────────────────────────────────────────────────────────────────┤
│  1. Detect provider from connected ChatModel node              │
│     const provider = chatModelNode.values?.provider || "openai"│
│                                                                │
│  2. Get provider config from registry                          │
│     const providerConfig = LLM_PROVIDERS[provider]             │
│                                                                │
│  3. Fetch credentials using provider-specific service type     │
│     const creds = CredentialManager.getCredentials(            │
│       user_id, providerConfig.serviceType, credential_id)      │
│                                                                │
│  4. Create model using factory                                 │
│     const llm = providerConfig.createModel(apiKey, {...})      │
└────────────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `coreza-backend/src/config/llmProviders.ts` | **Create** | LLM provider registry with factory functions |
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | **Modify** | Use provider registry instead of hardcoded OpenAI |
| `src/nodes/OpenAIChatModel.json` | **Modify** | Add `provider: "openai"` field |
| `src/nodes/GeminiChatModel.json` | **Create** | New Gemini Chat Model node |

---

## Technical Details

### 1. LLM Provider Registry (`coreza-backend/src/config/llmProviders.ts`)

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface LLMProviderConfig {
  /** Provider identifier (matches JSON provider field) */
  id: string;
  
  /** Service type for credential lookup */
  serviceType: string;
  
  /** Key in client_json for API key */
  apiKeyField: string;
  
  /** Models that don't support temperature parameter */
  noTemperatureModels?: string[];
  
  /** Default model if none specified */
  defaultModel: string;
  
  /** Factory to create LangChain chat model */
  createModel: (config: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) => BaseChatModel;
}

export const LLM_PROVIDERS: Record<string, LLMProviderConfig> = {
  openai: {
    id: "openai",
    serviceType: "openaichatmodel",
    apiKeyField: "apiKey",
    noTemperatureModels: [
      "gpt-4o-search-preview",
      "gpt-4o-mini-search-preview"
    ],
    defaultModel: "gpt-4o-mini",
    createModel: ({ apiKey, model, temperature, maxTokens }) => {
      const isSearchModel = LLM_PROVIDERS.openai.noTemperatureModels?.includes(model);
      
      const config: any = {
        modelName: model,
        apiKey,
      };
      
      if (!isSearchModel) {
        config.temperature = temperature ?? 0.7;
        config.maxTokens = maxTokens;
      } else {
        config.modelKwargs = { web_search_options: {} };
      }
      
      return new ChatOpenAI(config);
    },
  },
  
  gemini: {
    id: "gemini",
    serviceType: "geminichatmodel",
    apiKeyField: "apiKey",
    defaultModel: "gemini-1.5-flash",
    createModel: ({ apiKey, model, temperature, maxTokens }) => {
      return new ChatGoogleGenerativeAI({
        modelName: model,
        apiKey,
        temperature: temperature ?? 0.7,
        maxOutputTokens: maxTokens,
      });
    },
  },
  
  // Future: anthropic, mistral, etc.
};

/** Get provider by ID, fallback to openai */
export function getProvider(providerId?: string): LLMProviderConfig {
  return LLM_PROVIDERS[providerId || "openai"] || LLM_PROVIDERS.openai;
}

/** Check if model supports temperature for given provider */
export function supportsTemperature(providerId: string, model: string): boolean {
  const provider = getProvider(providerId);
  return !provider.noTemperatureModels?.includes(model);
}
```

### 2. Updated AIAgentExecutor

Key changes in `execute()` method:

```typescript
// Before (hardcoded)
import { ChatOpenAI } from "@langchain/openai";
// ...
const credentialResponse = await CredentialManager.getCredentials(
  user_id, "openaichatmodel", credential_id
);
// ...
const llm = new ChatOpenAI(llmConfig);

// After (generic)
import { getProvider, LLM_PROVIDERS } from "../../config/llmProviders";
// ...

// Detect provider from node values
const providerId = chatModelNode.values?.provider || "openai";
const provider = getProvider(providerId);

// Get credentials using provider's service type
const credentialResponse = await CredentialManager.getCredentials(
  user_id, provider.serviceType, credential_id
);

// Extract API key using provider's key field
const apiKey = client_json[provider.apiKeyField];

// Create model using provider factory
const model = chatModelNode.values?.model || provider.defaultModel;
const llm = provider.createModel({
  apiKey,
  model,
  temperature: Number(temperature),
  maxTokens: Number(maxTokens),
});
```

### 3. Updated OpenAIChatModel.json

Add `provider` field:

```json
{
  "name": "OpenAIChatModel",
  "def": "OpenAI Chat Model",
  "node_type": "sub",
  "category": "ChatModel",
  "provider": "openai",
  ...
}
```

### 4. New GeminiChatModel.json

```json
{
  "name": "GeminiChatModel",
  "def": "Google Gemini Chat Model",
  "node_type": "sub",
  "category": "ChatModel",
  "provider": "gemini",
  "icon": "/assets/icons/gemini.svg",
  "size": { "width": 300, "height": 280 },
  "handles": [{ "type": "source", "position": "top", "id": "chatModel" }],
  "auth": "GenericAuthModal",
  "authFields": [
    {
      "key": "credential_name",
      "label": "Credential Label",
      "type": "text",
      "default": "Gemini API"
    },
    {
      "key": "apiKey",
      "label": "Google AI API Key",
      "type": "password",
      "placeholder": "AI..."
    }
  ],
  "authAction": { "url": "/gemini/auth", "method": "POST" },
  "fields": [
    {
      "key": "credential_id",
      "label": "Credential",
      "type": "select",
      "optionsSource": "credentialsApi",
      "placeholder": "Select credential",
      "required": true
    },
    {
      "key": "model",
      "label": "Model",
      "type": "select",
      "default": "gemini-1.5-flash",
      "options": [
        { "label": "Gemini 1.5 Pro", "value": "gemini-1.5-pro" },
        { "label": "Gemini 1.5 Flash", "value": "gemini-1.5-flash" },
        { "label": "Gemini 1.0 Pro", "value": "gemini-1.0-pro" }
      ],
      "required": true
    },
    {
      "key": "temperature",
      "label": "Temperature",
      "type": "number",
      "default": 0.7,
      "required": false
    },
    {
      "key": "maxTokens",
      "label": "Max Output Tokens",
      "type": "number",
      "default": 1000,
      "required": false
    }
  ]
}
```

---

## Dependencies Required

Add to `coreza-backend/package.json`:

```json
{
  "dependencies": {
    "@langchain/google-genai": "^0.1.6"
  }
}
```

---

## Adding a New Provider (Future)

To add a new LLM provider (e.g., Anthropic), you only need:

1. **Create JSON node** (`src/nodes/AnthropicChatModel.json`)
2. **Add provider config** to `llmProviders.ts`:
   ```typescript
   anthropic: {
     id: "anthropic",
     serviceType: "anthropicchatmodel",
     apiKeyField: "apiKey",
     defaultModel: "claude-3-opus",
     createModel: ({ apiKey, model, temperature }) => {
       return new ChatAnthropic({ ... });
     },
   }
   ```
3. **Add dependency** (`@langchain/anthropic`)

No changes to `AIAgentExecutor.ts` required!

---

## Summary

| Change | Benefit |
|--------|---------|
| Provider registry | Single place to add new LLM providers |
| Factory pattern | No code changes in AIAgentExecutor for new providers |
| JSON-driven nodes | UI automatically shows new models |
| Provider field in JSON | Links frontend to backend config |

This makes the system truly extensible - adding any new LLM just requires:
- 1 JSON file (frontend)
- ~10 lines in registry (backend)
- No modifications to core executor logic
