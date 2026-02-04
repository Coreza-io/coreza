
# Plan: Unify Webhook Registration with Generic Action Path

## Problem

Webhook triggers use a **hardcoded API call** in `useNodeExecution.ts`:
```typescript
const registerResponse = await apiClient.post('/webhooks/register', {
  provider,
  workflow_id: workflowId,
  node_id: nodeId,
  credential_id: fieldState.credential_id,
  ...
}, session?.access_token);
```

While streaming triggers define their endpoint in JSON and use the **generic action path**:
```json
{
  "executionMode": "streaming",
  "action": {
    "url": "/stream/execute-stream-node",
    "method": "POST"
  }
}
```

This inconsistency forces separate code paths for what is conceptually the same operation.

---

## Solution

Add `action` property to webhook trigger JSONs and remove the hardcoded webhook registration logic. Both webhook and streaming triggers will then use the same generic action execution path.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/nodes/WebhookTrigger.json` | Add `action` property pointing to `/webhooks/register` |
| `src/nodes/TelegramTrigger.json` | Add `action` property pointing to `/webhooks/register` |
| `src/hooks/useNodeExecution.ts` | Remove hardcoded webhook registration block, use generic action path |

---

## Implementation

### 1. Update WebhookTrigger.json

Add action configuration:

```json
{
  "name": "WebhookTrigger",
  "node_type": "trigger",
  "executionMode": "webhook_listening",
  "action": {
    "url": "/webhooks/register",
    "method": "POST"
  },
  "listeningConfig": {
    "provider": "generic",
    "waitField": "webhookPayload",
    "timeout": 300000
  },
  ...
}
```

### 2. Update TelegramTrigger.json

Add action configuration:

```json
{
  "name": "TelegramTrigger",
  "node_type": "trigger", 
  "executionMode": "webhook_listening",
  "action": {
    "url": "/webhooks/register",
    "method": "POST"
  },
  "listeningConfig": {
    "provider": "telegram",
    "waitField": "webhookPayload",
    "timeout": 300000
  },
  ...
}
```

### 3. Simplify useNodeExecution.ts

Replace the 145-line hardcoded webhook block with generic action execution:

**Before (hardcoded):**
```typescript
if (definition?.executionMode === "webhook_listening") {
  const provider = definition.name === "WebhookTrigger" 
    ? "generic" 
    : definition.name.replace("Trigger", "").toLowerCase();
  
  const registerResponse = await apiClient.post('/webhooks/register', {
    provider,
    workflow_id: workflowId,
    node_id: nodeId,
    ...
  }, session?.access_token);
  // ... 145 lines of webhook-specific code
}
```

**After (uses generic path):**
```typescript
// Webhook triggers now fall through to the generic action handler
// because they have action.url defined in their JSON

// In the generic action handler section (around line 653):
if (definition?.action?.url && definition?.action?.method) {
  const res = await apiClient.request(fullUrl, {...});
  const responseData = await res.json();
  
  // Handle both streaming AND webhook listening modes
  const isListeningMode = 
    definition?.executionMode === "streaming" ||
    definition?.executionMode === "webhook_listening";
    
  if (isListeningMode) {
    const handler = createListeningHandler({
      // Config from definition.listeningConfig or definition.streamingConfig
      ...
    }, deps);
    await handler.start();
    return;
  }
}
```

### 4. Backend Payload Mapping

The backend `/webhooks/register` already expects `workflow_id`, `node_id`, etc. The generic payload builder needs to map these:

```typescript
// Ensure the payload includes required webhook fields
const payload = {
  ...fieldState,
  workflow_id: workflowId,
  node_id: nodeId,
  provider: definition?.listeningConfig?.provider || 
            definition.name.replace("Trigger", "").toLowerCase(),
};
```

---

## Unified Flow

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Node JSON Definition                          │
├─────────────────────────────────────────────────────────────────┤
│  WebhookTrigger.json                AlpacaStreamData.json       │
│  ├─ executionMode: webhook_listening   ├─ executionMode: streaming│
│  ├─ action.url: /webhooks/register     ├─ action.url: /stream/... │
│  └─ listeningConfig: {...}             └─ streamingConfig: {...}  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│               useNodeExecution - Generic Action Path             │
├─────────────────────────────────────────────────────────────────┤
│  1. Build payload from fieldState + workflow/node IDs           │
│  2. Call action.url with action.method                          │
│  3. If executionMode is "streaming" OR "webhook_listening":     │
│     └─► createListeningHandler(config from JSON, deps).start()  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Webhook registration | Hardcoded 145 lines | Uses generic action path |
| Adding new webhook providers | Modify useNodeExecution.ts | Just create JSON |
| Code duplication | Webhook vs Streaming logic | Single unified handler |
| Provider derivation | `definition.name.replace("Trigger", "")` | `listeningConfig.provider` in JSON |
| Maintainability | Two code paths | One code path |

---

## Summary

| Change | Impact |
|--------|--------|
| Add `action` + `listeningConfig` to webhook JSONs | Enables generic execution |
| Remove hardcoded webhook block from useNodeExecution | -145 lines |
| Unify with streaming handler path | Single code path for all listening nodes |

This makes webhook triggers truly config-driven like streaming triggers - no special-cased code needed.
