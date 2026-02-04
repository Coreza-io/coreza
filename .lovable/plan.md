# Plan: Unify Webhook Registration with Generic Action Path

## ✅ COMPLETED

This plan has been implemented. The following changes were made:

### Changes Made

| File | Change |
|------|--------|
| `src/nodes/WebhookTrigger.json` | Added `action` and `listeningConfig` properties |
| `src/nodes/TelegramTrigger.json` | Added `action` and `listeningConfig` properties |
| `src/hooks/useNodeExecution.ts` | Removed 145-line hardcoded webhook block, integrated into generic action path |

### Implementation Details

1. **WebhookTrigger.json** and **TelegramTrigger.json** now include:
   ```json
   {
     "action": {
       "url": "/webhooks/register",
       "method": "POST"
     },
     "listeningConfig": {
       "provider": "generic|telegram",
       "waitField": "webhookPayload",
       "timeout": 300000,
       "listeningFlag": "isListening"
     }
   }
   ```

2. **useNodeExecution.ts** now handles `webhook_listening` mode in the generic action handler section, using config from `listeningConfig` in the JSON definition.

### Unified Flow

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
│     └─► Handle listening state with config from JSON            │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits Achieved

- Removed ~145 lines of hardcoded webhook registration
- Webhook triggers now config-driven like streaming triggers
- Single code path for all listening modes
- Adding new webhook providers only requires JSON config
