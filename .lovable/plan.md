

# Plan: Config-Driven Communication Services

## Current State Analysis

### Problems with Current Implementation

1. **Service-specific classes in code** - Each service (Gmail, WhatsApp, Telegram) has its own class with hardcoded methods
2. **Switch statements everywhere** - Both route and CommunicationService.execute() require manual updates
3. **CommunicationExecutor has switch** - Adding new service requires code change
4. **Auth validation hardcoded in route** - Each service's credential validation is in the route file

### Current Structure (Code-Heavy)

```text
communications.ts (728 lines!)
├── GmailService class (methods: sendEmail, getMessages, getMessage)
├── WhatsAppService class (methods: sendMessage, sendTemplate, sendMedia, listTemplates)
├── TelegramService class (methods: sendMessage, sendPhoto, sendDocument)
└── CommunicationService.execute() → switch(service)

communication.ts (route)
└── POST /:service/auth → switch(service) for validation

CommunicationExecutor.ts
└── execute() → switch(nodeName) for Gmail/WhatsApp/Telegram
```

### Target Structure (Config-Only)

```text
services/communication/
├── types.ts              # Interface definitions
├── communicationService.ts  # Generic service (like DataSourceService)
├── registry.ts           # Service registry
├── index.ts              # Auto-discovery & initialization
└── configs/              # ADD NEW SERVICES HERE ONLY
    ├── telegram.ts
    ├── whatsapp.ts
    └── gmail.ts          # Uses OAuth (special handling)
```

---

## New Architecture

### CommunicationConfig Interface

```typescript
interface CommunicationConfig {
  serviceKey: string;
  authType: "token" | "oauth" | "api_key";
  baseUrl: string | ((creds: any) => string);
  
  // Credential validation (for auth endpoint)
  validateCredentials?: (credentials: any) => Promise<{ valid: boolean; error?: string }>;
  
  // Auth header construction
  makeAuthHeaders: (creds: any) => Record<string, string>;
  
  // Operations (like DataSource ops)
  operations: Record<string, CommunicationOperation>;
}

interface CommunicationOperation {
  method: "get" | "post" | "put" | "delete";
  path: string | ((input: any, creds: any) => string);
  makeBody?: (input: any, creds: any) => any;
  makeParams?: (input: any, creds: any) => Record<string, any>;
  transformResult?: (data: any, input: any) => any;
  validateInput?: (input: any) => { valid: boolean; error?: string };
}
```

---

## Config Examples

### Telegram Config

```typescript
// configs/telegram.ts
export const telegramConfig: CommunicationConfig = {
  serviceKey: "telegram",
  authType: "token",
  baseUrl: (creds) => `https://api.telegram.org/bot${creds.bot_token}`,
  
  validateCredentials: async (creds) => {
    const response = await axios.get(
      `https://api.telegram.org/bot${creds.bot_token}/getMe`
    );
    return { valid: response.data.ok };
  },
  
  makeAuthHeaders: () => ({}), // Telegram uses token in URL
  
  operations: {
    send_message: {
      method: "post",
      path: "/sendMessage",
      makeBody: (input) => ({
        chat_id: input.chat_id,
        text: input.message,
        parse_mode: input.parse_mode || "HTML",
      }),
      transformResult: (data) => ({
        success: true,
        message_id: data.result.message_id,
      }),
    },
    send_photo: {
      method: "post",
      path: "/sendPhoto",
      makeBody: (input) => ({
        chat_id: input.chat_id,
        photo: input.photo_url,
        caption: input.caption,
        parse_mode: input.parse_mode || "HTML",
      }),
    },
    send_document: {
      method: "post",
      path: "/sendDocument",
      makeBody: (input) => ({
        chat_id: input.chat_id,
        document: input.document_url,
        caption: input.caption,
        parse_mode: input.parse_mode || "HTML",
      }),
    },
  },
};
```

### WhatsApp Config

```typescript
// configs/whatsapp.ts
export const whatsappConfig: CommunicationConfig = {
  serviceKey: "whatsapp",
  authType: "token",
  baseUrl: (creds) => 
    `https://graph.facebook.com/v17.0/${creds.phone_number_id}`,
  
  makeAuthHeaders: (creds) => ({
    Authorization: `Bearer ${creds.access_token}`,
    "Content-Type": "application/json",
  }),
  
  operations: {
    send_message: {
      method: "post",
      path: "/messages",
      makeBody: (input) => ({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: { body: input.message },
      }),
      transformResult: (data) => ({
        success: true,
        messageId: data.messages[0].id,
      }),
    },
    send_template: {
      method: "post",
      path: "/messages",
      makeBody: (input) => ({
        messaging_product: "whatsapp",
        to: input.to,
        type: "template",
        template: {
          name: input.template_name,
          language: { code: input.language_code || "en_US" },
        },
      }),
    },
    send_media: {
      method: "post",
      path: "/messages",
      makeBody: (input) => ({
        messaging_product: "whatsapp",
        to: input.to,
        type: input.media_type,
        [input.media_type]: {
          link: input.media_url,
          caption: input.caption,
        },
      }),
    },
  },
};
```

### Gmail Config (OAuth)

```typescript
// configs/gmail.ts
export const gmailConfig: CommunicationConfig = {
  serviceKey: "gmail",
  authType: "oauth",
  baseUrl: "https://gmail.googleapis.com/gmail/v1",
  
  makeAuthHeaders: async (creds) => ({
    Authorization: `Bearer ${creds.access_token}`,
    "Content-Type": "application/json",
  }),
  
  operations: {
    send: {
      method: "post",
      path: "/users/me/messages/send",
      makeBody: (input) => {
        const raw = buildRawEmail(input.to, input.subject, input.body);
        return { raw };
      },
      transformResult: (data) => ({
        success: true,
        messageId: data.id,
      }),
    },
    get_messages: {
      method: "get",
      path: "/users/me/messages",
      makeParams: (input) => ({
        q: input.query,
        maxResults: input.max_results || 10,
      }),
    },
    get_message: {
      method: "get",
      path: (input) => `/users/me/messages/${input.messageId}`,
      makeParams: () => ({ format: "full" }),
    },
  },
};
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `services/communication/types.ts` | CommunicationConfig, CommunicationOperation interfaces |
| `services/communication/communicationService.ts` | Generic service class (like DataSourceService) |
| `services/communication/registry.ts` | Service registry map |
| `services/communication/index.ts` | Auto-discover configs, initialize services |
| `services/communication/configs/telegram.ts` | Telegram config |
| `services/communication/configs/whatsapp.ts` | WhatsApp config |
| `services/communication/configs/gmail.ts` | Gmail config (with OAuth helpers) |

---

## Files to Modify

| File | Change |
|------|--------|
| `routes/communication.ts` | Use registry, generic auth validation |
| `nodes/executors/CommunicationExecutor.ts` | Remove switch, use registry lookup |
| `index.ts` | Call `initializeCommunicationServices()` |

---

## Files to Delete

| File |
|------|
| `services/communications.ts` (the 728-line file) |

---

## Updated Route (Generic)

```typescript
// routes/communication.ts
import { getCommunicationService } from "../services/communication";

router.post("/:service/:operation", async (req, res) => {
  const service = getCommunicationService(req.params.service);
  if (!service) {
    return res.status(400).json({ error: `Unknown service: ${req.params.service}` });
  }
  
  const result = await service.execute({
    operation: req.params.operation,
    user_id: req.user.id,
    ...req.body,
  });
  
  res.json(result);
});

router.post("/:service/auth", async (req, res) => {
  const service = getCommunicationService(req.params.service);
  if (!service) {
    return res.status(400).json({ error: `Unknown service: ${req.params.service}` });
  }
  
  // Service config knows which fields are required
  const validation = await service.validateCredentials(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  
  // Store credentials generically
  const credentialId = await CredentialManager.storeCredentials(
    req.user.id,
    req.params.service,
    req.body.credential_name,
    req.body
  );
  
  res.json({ success: true, credential_id: credentialId });
});
```

---

## Updated CommunicationExecutor (Generic)

```typescript
// No more switch statement!
export class CommunicationExecutor implements INodeExecutor {
  readonly category = "Communication";

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const serviceKey = node.name.toLowerCase(); // Gmail → gmail
    const service = getCommunicationService(serviceKey);
    
    if (!service) {
      return toNodeResult(createErrorOutput(`Unknown service: ${node.name}`, ctx));
    }
    
    const result = await service.execute({
      operation: node.values?.operation || "send",
      user_id: context.user_id,
      credential_id: node.values?.credential_id,
      ...input,
      ...node.values,
    });
    
    return toNodeResult(normalizeOutput(result, ctx));
  }
}
```

---

## Adding New Service (Slack Example)

To add Slack, you only need to:

1. **Create config file**: `configs/slack.ts`

```typescript
export const slackConfig: CommunicationConfig = {
  serviceKey: "slack",
  authType: "token",
  baseUrl: "https://slack.com/api",
  
  validateCredentials: async (creds) => {
    const response = await axios.get("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${creds.bot_token}` },
    });
    return { valid: response.data.ok };
  },
  
  makeAuthHeaders: (creds) => ({
    Authorization: `Bearer ${creds.bot_token}`,
    "Content-Type": "application/json",
  }),
  
  operations: {
    send_message: {
      method: "post",
      path: "/chat.postMessage",
      makeBody: (input) => ({
        channel: input.channel,
        text: input.message,
      }),
    },
  },
};
```

2. **Create frontend node**: `src/nodes/Slack.json`

**That's it! No backend code changes needed.**

---

## Benefits

1. **Zero code changes for new services** - Just add config file + node JSON
2. **Consistent patterns** - Same approach as DataSource and Storage
3. **Simpler route** - No switch statements, fully generic
4. **Simpler executor** - No switch statements, uses registry
5. **Easier testing** - Each config is isolated and testable
6. **~700 lines of code removed** - Replaced with ~50-80 lines per config

---

## Implementation Order

1. Create `services/communication/` directory structure
2. Create types.ts with interfaces
3. Create communicationService.ts (generic executor)
4. Create registry.ts and index.ts (auto-discovery)
5. Create configs for telegram, whatsapp, gmail
6. Update route to use registry
7. Update executor to use registry
8. Delete old communications.ts
9. Test all services

