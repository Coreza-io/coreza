

# Plan: Unify Communication Services Routes

## Current State Analysis

### Existing Structure

```text
Routes (3 separate files):
├── gmail.ts      → /gmail/*      (4 endpoints)
├── whatsapp.ts   → /whatsapp/*   (7 endpoints + webhooks)
└── telegram.ts   → /telegram/*   (1 endpoint - credentials only)

Service:
└── communications.ts
    ├── GmailService      (send_email, get_messages, get_message)
    ├── WhatsAppService   (send_message, send_template, send_media, etc.)
    └── CommunicationService.execute(service, operation, input)

Nodes:
├── Gmail.json        → category: "Email"
├── WhatsApp.json     → category: "Communication"
└── TelegramTrigger.json (trigger only, no send node)
```

### Problems

1. Three separate route files for services that share CommunicationService
2. Telegram has no send functionality (only trigger)
3. Inconsistent categories (Gmail is "Email", WhatsApp is "Communication")
4. WhatsApp webhooks mixed with authenticated operations

---

## Proposed Unified Architecture

### New Structure

```text
Routes:
└── communication.ts → /communication/:service/:operation
    ├── POST /communication/gmail/send
    ├── POST /communication/gmail/messages
    ├── POST /communication/whatsapp/send
    ├── POST /communication/telegram/send  (NEW)
    ├── GET  /communication/:service/credentials
    └── POST /communication/:service/auth

Public Routes (kept separate):
└── whatsapp.ts → /whatsapp/webhook (GET/POST for WhatsApp verification)

Service:
└── communications.ts
    ├── GmailService
    ├── WhatsAppService
    └── TelegramService (NEW)

Nodes:
├── Gmail.json        → category: "Communication"
├── WhatsApp.json     → category: "Communication"
└── Telegram.json     → category: "Communication" (NEW send node)
```

---

## Implementation Steps

### Phase 1: Create Unified Communication Route

**File:** `coreza-backend/src/routes/communication.ts`

```typescript
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { CommunicationService } from "../services/communications";
import CredentialManager from "../utils/credentialManager";

const router = Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// Generic communication operation
// POST /communication/:service/:operation
router.post("/:service/:operation", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { service, operation } = req.params;
  const { credential_id, ...params } = req.body;

  const result = await CommunicationService.execute(service, operation, {
    user_id: userId,
    credential_id,
    ...params,
  });

  res.json(result);
});

// Get credentials for a communication service
// GET /communication/:service/credentials
router.get("/:service/credentials", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { service } = req.params;
  
  const credentials = await CredentialManager.listCredentials(userId, service);
  res.json({ success: true, credentials });
});

// Save credentials for a communication service
// POST /communication/:service/auth
router.post("/:service/auth", async (req: Request, res: Response) => {
  // Validates and stores credentials per service type
  // Telegram: validates bot_token via Telegram API
  // WhatsApp: validates access_token, phone_number_id
  // Gmail: handled via OAuth flow
});

export default router;
```

---

### Phase 2: Add TelegramService to communications.ts

**File:** `coreza-backend/src/services/communications.ts`

Add new TelegramService class:

```typescript
class TelegramService extends BaseCommunicationService {
  protected serviceName = "telegram";

  async execute(operation: string, input: CommunicationInput): Promise<StandardNodeOutput> {
    const { userId, credentialId } = this.normalizeIds(input);
    
    // Get bot_token from credentials
    const result = await CredentialManager.getCredentials(userId, "telegram", credentialId);
    const credentials = result.credentials;

    switch (operation) {
      case "send":
      case "send_message":
        return this.sendMessage(credentials, input);
      case "send_photo":
        return this.sendPhoto(credentials, input);
      case "send_document":
        return this.sendDocument(credentials, input);
      default:
        throw createError(`Unsupported Telegram operation: ${operation}`, 400);
    }
  }

  private async sendMessage(credentials: any, input: CommunicationInput) {
    const { chat_id, message, parse_mode = "HTML" } = input;
    
    const response = await axios.post(
      `https://api.telegram.org/bot${credentials.bot_token}/sendMessage`,
      { chat_id, text: message, parse_mode }
    );
    
    return { success: true, message_id: response.data.result.message_id };
  }
}
```

Update CommunicationService.execute to include telegram:

```typescript
case "telegram":
  return this.telegramService.execute(operation, input);
```

---

### Phase 3: Create Telegram Send Node

**File:** `src/nodes/Telegram.json`

```json
{
  "name": "Telegram",
  "def": "Send Telegram Message",
  "node_type": "main",
  "category": "Communication",
  "handles": [
    { "type": "target", "position": "left", "id": "input" },
    { "type": "source", "position": "right", "id": "output" }
  ],
  "auth": "GenericAuthModal",
  "authFields": [
    { "key": "credential_name", "label": "Credential Label", "type": "text", "default": "Telegram Bot" },
    { "key": "bot_token", "label": "Bot Token", "type": "password", "required": true }
  ],
  "authAction": { "url": "/communication/telegram/auth", "method": "POST" },
  "icon": "/assets/icons/telegram.svg",
  "size": { "width": 340, "height": 380 },
  "action": { "url": "/communication/telegram/send", "method": "POST" },
  "fields": [
    { "key": "credential_id", "label": "Credential", "type": "select", "optionsSource": "credentialsApi", "required": true },
    { "key": "operation", "label": "Operation", "type": "select", "default": "send_message",
      "options": [
        { "label": "Send Message", "value": "send_message" },
        { "label": "Send Photo", "value": "send_photo" },
        { "label": "Send Document", "value": "send_document" }
      ]
    },
    { "key": "chat_id", "label": "Chat ID", "type": "text", "required": true },
    { "key": "message", "label": "Message", "type": "textarea", "required": true },
    { "key": "parse_mode", "label": "Parse Mode", "type": "select", "default": "HTML",
      "options": [
        { "label": "HTML", "value": "HTML" },
        { "label": "Markdown", "value": "Markdown" },
        { "label": "MarkdownV2", "value": "MarkdownV2" }
      ]
    }
  ]
}
```

---

### Phase 4: Update Existing Nodes

**File:** `src/nodes/Gmail.json`

Update to use unified route:
```json
{
  "category": "Communication",
  "authAction": { "url": "/oauth/gmail/generate-auth-url", "method": "POST" },
  "action": { "url": "/communication/gmail/send", "method": "POST" }
}
```

**File:** `src/nodes/WhatsApp.json`

Update to use unified route:
```json
{
  "authAction": { "url": "/communication/whatsapp/auth", "method": "POST" },
  "action": { "url": "/communication/whatsapp/send", "method": "POST" }
}
```

---

### Phase 5: Update CommunicationExecutor

**File:** `coreza-backend/src/nodes/executors/CommunicationExecutor.ts`

Add Telegram case:

```typescript
case "Telegram":
  result = await CommunicationService.execute("telegram", operation, combinedInput);
  break;
```

---

### Phase 6: Update index.ts

**File:** `coreza-backend/src/index.ts`

Replace three routes with one:
```typescript
// Remove:
// import gmailRoutes from "./routes/gmail";
// import whatsappRoutes from "./routes/whatsapp";
// import telegramRoutes from "./routes/telegram";
// app.use("/gmail", gmailRoutes);
// app.use("/whatsapp", whatsappRoutes);
// app.use("/telegram", telegramRoutes);

// Add:
import communicationRoutes from "./routes/communication";
import whatsappWebhookRoutes from "./routes/whatsappWebhook"; // Public webhooks only
app.use("/communication", communicationRoutes);
app.use("/whatsapp", whatsappWebhookRoutes); // Keep public webhook routes
```

---

### Phase 7: Keep WhatsApp Webhook Route (Public)

**File:** `coreza-backend/src/routes/whatsappWebhook.ts`

Extract only the public webhook handlers:
```typescript
// GET /whatsapp/webhook - Verification (public)
// POST /whatsapp/webhook - Event handling (public)
```

---

## Files Summary

| Action | File |
|--------|------|
| Create | `coreza-backend/src/routes/communication.ts` |
| Create | `coreza-backend/src/routes/whatsappWebhook.ts` |
| Create | `src/nodes/Telegram.json` |
| Modify | `coreza-backend/src/services/communications.ts` (add TelegramService) |
| Modify | `coreza-backend/src/nodes/executors/CommunicationExecutor.ts` (add Telegram) |
| Modify | `coreza-backend/src/index.ts` (update route imports) |
| Modify | `src/nodes/Gmail.json` (update category + action URL) |
| Modify | `src/nodes/WhatsApp.json` (update authAction + action URL) |
| Delete | `coreza-backend/src/routes/gmail.ts` |
| Delete | `coreza-backend/src/routes/telegram.ts` |
| Modify | `coreza-backend/src/routes/whatsapp.ts` → becomes `whatsappWebhook.ts` |

---

## Benefits

1. **Single route file** for all communication services (like storage pattern)
2. **Consistent URL structure**: `/communication/:service/:operation`
3. **Telegram send capability** added (currently only has trigger)
4. **Unified category**: All nodes under "Communication"
5. **Extensible**: Add new services (Slack, Discord, SMS) by adding service class only
6. **Public webhooks separated** from authenticated operations

