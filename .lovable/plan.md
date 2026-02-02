# Plan: Make AI Agent Generic for Any LLM Provider

## ✅ COMPLETED

The AI Agent system has been refactored to support any LLM provider via a registry pattern.

---

## What Was Implemented

### 1. LLM Provider Registry
**File:** `coreza-backend/src/config/llmProviders.ts`

- Factory pattern for creating LangChain models
- Provider configs for OpenAI and Gemini
- Handles model-specific quirks (e.g., OpenAI search models don't support temperature)

### 2. Generic AIAgentExecutor
**File:** `coreza-backend/src/nodes/executors/AIAgentExecutor.ts`

- Detects `provider` from connected ChatModel node
- Uses registry for credential lookup and model creation
- No longer hardcoded to OpenAI

### 3. Updated JSON Nodes
- `src/nodes/OpenAIChatModel.json` - Added `"provider": "openai"`
- `src/nodes/GeminiChatModel.json` - New Gemini Chat Model node

### 4. Cleanup
- Deleted `coreza-backend/src/utils/openaiModels.ts` (moved to registry)

---

## Adding a New Provider

To add a new LLM (e.g., Anthropic):

1. **Create JSON node** (`src/nodes/AnthropicChatModel.json`):
```json
{
  "name": "AnthropicChatModel",
  "provider": "anthropic",
  "category": "ChatModel",
  ...
}
```

2. **Add to registry** (`coreza-backend/src/config/llmProviders.ts`):
```typescript
anthropic: {
  id: "anthropic",
  serviceType: "anthropicchatmodel",
  apiKeyField: "apiKey",
  defaultModel: "claude-3-opus",
  createModel: ({ apiKey, model, temperature, maxTokens }) => {
    return new ChatAnthropic({ ... });
  },
}
```

3. **Add dependency**: `@langchain/anthropic`

**No changes to AIAgentExecutor.ts required!**
