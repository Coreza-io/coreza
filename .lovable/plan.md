

# Plan: Consolidate WhatsApp Webhooks into Unified Webhook System

## Current State Analysis

### Two Separate Webhook Systems

```text
1. webhook.ts + WebhookService + webhookProviders.ts
   └── Handles: generic, telegram
   └── Purpose: Trigger workflows via webhooks
   └── Config-driven via webhookProviders.ts

2. whatsappWebhook.ts (standalone)
   └── Handles: WhatsApp Cloud API
   └── Purpose: Verification + message handling (auto-reply)
   └── Uses deleted CommunicationService (broken!)
```

### Why Consolidate?

- WhatsApp webhooks should trigger workflows just like Telegram
- Avoids duplicate code for webhook handling
- Single config-driven system for all providers
- Fixes the broken import error

---

## Proposed Architecture

Add WhatsApp as a provider in `webhookProviders.ts` and remove the separate route file.

```text
After Consolidation:

webhook.ts + WebhookService + webhookProviders.ts
├── generic   (existing)
├── telegram  (existing)  
└── whatsapp  (NEW - add provider config)

Routes:
├── GET  /webhooks/whatsapp/verify (verification challenge)
├── POST /webhooks/whatsapp/incoming/:userId/:workflowId/:nodeId (events)
```

---

## Implementation Steps

### Step 1: Add WhatsApp Provider to webhookProviders.ts

**File:** `coreza-backend/src/config/webhookProviders.ts`

```typescript
whatsapp: {
  id: "whatsapp",
  name: "WhatsApp Cloud API",
  incomingPath: "whatsapp",
  
  verification: {
    method: "direct",
    headerName: "x-hub-signature-256", // Optional HMAC verification
  },
  
  // WhatsApp requires a separate verification endpoint (hub.challenge)
  verifyChallenge: (query: Record<string, any>) => {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];
    const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
    
    if (mode === "subscribe" && token === expectedToken) {
      return { valid: true, challenge };
    }
    return { valid: false };
  },
  
  normalizePayload: ({ body }) => {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    
    return {
      timestamp: new Date().toISOString(),
      messageType: message?.type || "unknown",
      from: message?.from,
      text: message?.text?.body,
      message,
      status: value?.statuses?.[0],
      metadata: value?.metadata,
      raw: body,
    };
  },
}
```

### Step 2: Add Verification Endpoint to webhook.ts

**File:** `coreza-backend/src/routes/webhook.ts`

Add a new route for WhatsApp verification (hub.challenge):

```typescript
/**
 * WhatsApp webhook verification (GET)
 * GET /webhooks/whatsapp/verify
 * NO AUTH - WhatsApp calls this to verify endpoint
 */
router.get("/:provider/verify", async (req, res) => {
  const { provider } = req.params;
  const providerConfig = getProviderConfig(provider);
  
  if (!providerConfig?.verifyChallenge) {
    return res.status(404).json({ error: "Provider does not support verification" });
  }
  
  const result = providerConfig.verifyChallenge(req.query);
  
  if (result.valid) {
    res.status(200).send(result.challenge);
  } else {
    res.sendStatus(403);
  }
});
```

### Step 3: Delete whatsappWebhook.ts

Since all webhook functionality is now handled by the unified system:

- Delete `coreza-backend/src/routes/whatsappWebhook.ts`
- Remove import from `index.ts`

### Step 4: Update index.ts

**File:** `coreza-backend/src/index.ts`

Remove the separate WhatsApp webhook route:

```typescript
// Remove:
import whatsappWebhookRoutes from "./routes/whatsappWebhook";
app.use("/whatsapp", whatsappWebhookRoutes);

// The unified /webhooks route handles everything
```

---

## Files Summary

| Action | File |
|--------|------|
| Modify | `coreza-backend/src/config/webhookProviders.ts` (add WhatsApp provider) |
| Modify | `coreza-backend/src/routes/webhook.ts` (add verification endpoint) |
| Modify | `coreza-backend/src/index.ts` (remove whatsappWebhook import) |
| Delete | `coreza-backend/src/routes/whatsappWebhook.ts` |

---

## URL Changes

| Before | After |
|--------|-------|
| `GET /whatsapp/webhook` | `GET /webhooks/whatsapp/verify` |
| `POST /whatsapp/webhook` | `POST /webhooks/whatsapp/incoming/:userId/:workflowId/:nodeId` |

WhatsApp webhook URL in Meta Dashboard would need to be updated to the new format.

---

## Benefits

1. **Single webhook system** for all providers (generic, telegram, whatsapp)
2. **Config-driven** - Add new providers by adding config only
3. **Fixes broken import** - No more dependency on deleted CommunicationService
4. **WhatsApp can trigger workflows** - Same as Telegram
5. **Consistent patterns** - All webhooks use WebhookService

---

## Technical Notes

### WhatsApp Verification Flow

WhatsApp requires a special verification endpoint that:
1. Receives `hub.mode`, `hub.verify_token`, `hub.challenge` as query params
2. Validates the token matches your configured token
3. Returns the `challenge` value as plain text (not JSON)

This is handled by the new `verifyChallenge` method in the provider config.

### Message Auto-Reply

The current auto-reply functionality in `whatsappWebhook.ts` will be removed. Auto-replies should be handled by:
1. Creating a WhatsApp Trigger node in a workflow
2. Connecting it to a Telegram/WhatsApp send node

This is the proper workflow-based approach consistent with the architecture.

