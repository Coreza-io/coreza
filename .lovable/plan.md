

## Plan: Add OpenAI Web Search Models to Existing Dropdown

### Overview

Add OpenAI's web search models to the existing `OpenAIChatModel.json` dropdown. These specialized models have web search capability built-in and work with the existing Chat Completions API - **no code changes needed in the executor!**

---

### Available Search Models

According to OpenAI docs, these models support web search via Chat Completions API:
- `gpt-4o-search-preview` - GPT-4o with web search (preview)
- `gpt-4o-mini-search-preview` - GPT-4o Mini with web search (preview)  
- `gpt-5-search-api` - GPT-5 with web search

---

### Implementation

**File:** `src/nodes/OpenAIChatModel.json`

Update the model options array:

```json
{
  "key": "model",
  "label": "Model",
  "type": "select",
  "default": "gpt-4o-mini",
  "options": [
    { "label": "GPT-4o", "value": "gpt-4o" },
    { "label": "GPT-4o Mini", "value": "gpt-4o-mini" },
    { "label": "GPT-4 Turbo", "value": "gpt-4-turbo" },
    { "label": "GPT-3.5 Turbo", "value": "gpt-3.5-turbo" },
    { "label": "--- Web Search Models ---", "value": "", "disabled": true },
    { "label": "GPT-4o Search", "value": "gpt-4o-search-preview" },
    { "label": "GPT-4o Mini Search", "value": "gpt-4o-mini-search-preview" }
  ],
  "required": true
}
```

---

### Technical Consideration

**How search models differ:**
- Standard models (`gpt-4o`): No web search, uses only training data
- Search models (`gpt-4o-search-preview`): **Automatically** searches the web for current information and includes citations

**No backend changes needed** because:
1. LangChain's `ChatOpenAI` passes the model name directly to OpenAI
2. The Chat Completions API handles search models transparently
3. Responses include inline citations automatically

---

### Alternative: Responses API (Future Enhancement)

If you want **optional** web search (where the agent can choose to search or not), that requires:
1. Switch from `ChatOpenAI` (Chat Completions) to OpenAI Responses API
2. Pass `tools: [{type: "web_search"}]` in the request
3. More complex response parsing for citations

This is more work but gives the AI agent control over when to search. The dropdown approach gives **always-on** search for selected models.

---

### Summary

| Approach | Effort | Search Behavior | Backend Changes |
|----------|--------|-----------------|-----------------|
| **Dropdown models** | Minimal | Always-on for search models | None |
| Responses API | Major | Agent-controlled (optional) | New API integration |

---

### Files to Modify

| File | Change |
|------|--------|
| `src/nodes/OpenAIChatModel.json` | Add search model options to dropdown |

