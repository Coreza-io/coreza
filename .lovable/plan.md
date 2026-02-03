

# Plan: Add Hidden `isSearchModel` Field for Search Models

## Approach

Add a hidden field in the JSON that gets auto-set when a search model is selected. The frontend will pass this value, and the backend factory will use it to conditionally exclude temperature and add `web_search_options`.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/nodes/OpenAIChatModel.json` | Add hidden `isSearchModel` field with `displayOptions` to auto-set based on model |
| `coreza-backend/src/config/llmProviders.ts` | Check `isSearchModel` flag instead of model name |

---

## Implementation

### 1. Update OpenAIChatModel.json

Add a hidden field that is set when search models are selected:

```json
{
  "key": "isSearchModel",
  "type": "hidden",
  "default": false,
  "displayOptions": {
    "setTrue": {
      "model": ["gpt-4o-search-preview", "gpt-4o-mini-search-preview"]
    }
  }
}
```

Or simpler - add `isSearchModel: true` directly to the model options:

```json
{
  "label": "GPT-4o Search",
  "value": "gpt-4o-search-preview",
  "isSearchModel": true
}
```

And the frontend serializes it into `values.isSearchModel` when that option is selected.

### 2. Update llmProviders.ts

Use the flag passed from frontend:

```typescript
openai: ({ apiKey, model, temperature, maxTokens, modelKwargs, isSearchModel }) => {
  return new ChatOpenAI({
    modelName: model,
    apiKey,
    temperature: isSearchModel ? undefined : temperature,
    maxTokens: isSearchModel ? undefined : maxTokens,
    modelKwargs: isSearchModel ? { web_search_options: {} } : modelKwargs,
  });
},
```

### 3. Update LLMConfig Interface

Add `isSearchModel` to the config:

```typescript
export interface LLMConfig {
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  modelKwargs?: Record<string, unknown>;
  isSearchModel?: boolean;  // NEW
}
```

### 4. Update AIAgentExecutor

Pass `isSearchModel` from node values:

```typescript
const llm = getLLM(providerId, {
  apiKey,
  model,
  temperature: Number(temperature),
  maxTokens: chatModelNode.values?.maxTokens
    ? Number(chatModelNode.values.maxTokens)
    : undefined,
  isSearchModel: chatModelNode.values?.isSearchModel,  // NEW - passed from frontend
});
```

---

## How It Works

1. User selects "GPT-4o Search" in dropdown
2. Frontend sees `isSearchModel: true` on that option and sets `values.isSearchModel = true`
3. Frontend serializes and sends to backend with `isSearchModel: true`
4. Backend factory receives `isSearchModel: true` and:
   - Sets `temperature: undefined`
   - Sets `modelKwargs: { web_search_options: {} }`

---

## Summary

| Change | Location |
|--------|----------|
| Add `isSearchModel: true` to search model options | `OpenAIChatModel.json` |
| Add `isSearchModel` to LLMConfig interface | `llmProviders.ts` |
| Check `isSearchModel` flag in factory | `llmProviders.ts` |
| Pass `isSearchModel` from node values | `AIAgentExecutor.ts` |

This is a simple, explicit approach - the JSON declares which models are search models, and the value is passed through to the backend.

