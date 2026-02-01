

# Plan: Update WebhookTrigger with Authentication Options

## Overview

Simplify the WebhookTrigger node update to focus only on adding authentication options, matching n8n's authentication modes.

---

## Fields to Keep/Add

| Field | Status | Description |
|-------|--------|-------------|
| webhookUrl | Keep | Display webhook URL |
| httpMethod | Keep | HTTP method selector (change default to POST) |
| filterEvents | Keep | Event type filtering |
| authentication | **Add** | None / Basic Auth / Header Auth / JWT Auth |
| authUsername | **Add** | Conditional for Basic Auth |
| authPassword | **Add** | Conditional for Basic Auth |
| authHeaderName | **Add** | Conditional for Header Auth |
| authHeaderValue | **Add** | Conditional for Header Auth |
| authJwtSecret | **Add** | Conditional for JWT Auth |

## Fields to Remove

- ~~path~~ (removed per request)
- ~~respondMode~~ (removed per request)
- ~~secret~~ (removed per request)
- ~~responseHeaders~~ (removed per request)

---

## Updated WebhookTrigger.json

```json
{
  "name": "WebhookTrigger",
  "node_type": "trigger",
  "category": "webhook",
  "icon": "webhook",
  "description": "Receive HTTP webhooks from external services",
  "color": "text-purple-500",
  "size": {
    "width": 360,
    "height": 400
  },
  "handles": [
    { "type": "source", "position": "right", "id": "output" }
  ],
  "executionMode": "webhook_listening",
  "fields": [
    {
      "key": "webhookUrl",
      "label": "Webhook URL",
      "type": "webhookUrl",
      "required": false
    },
    {
      "key": "httpMethod",
      "label": "HTTP Method",
      "type": "select",
      "options": [
        { "label": "GET", "value": "GET" },
        { "label": "POST", "value": "POST" },
        { "label": "PUT", "value": "PUT" },
        { "label": "PATCH", "value": "PATCH" },
        { "label": "DELETE", "value": "DELETE" },
        { "label": "HEAD", "value": "HEAD" }
      ],
      "default": "POST",
      "required": false
    },
    {
      "key": "authentication",
      "label": "Authentication",
      "type": "select",
      "options": [
        { "label": "None", "value": "none" },
        { "label": "Basic Auth", "value": "basicAuth" },
        { "label": "Header Auth", "value": "headerAuth" },
        { "label": "JWT Auth", "value": "jwtAuth" }
      ],
      "default": "none",
      "required": false
    },
    {
      "key": "authUsername",
      "label": "Username",
      "type": "text",
      "placeholder": "Enter username",
      "required": true,
      "displayOptions": {
        "show": { "authentication": ["basicAuth"] }
      }
    },
    {
      "key": "authPassword",
      "label": "Password",
      "type": "password",
      "placeholder": "Enter password",
      "required": true,
      "displayOptions": {
        "show": { "authentication": ["basicAuth"] }
      }
    },
    {
      "key": "authHeaderName",
      "label": "Header Name",
      "type": "text",
      "placeholder": "X-API-Key",
      "required": true,
      "displayOptions": {
        "show": { "authentication": ["headerAuth"] }
      }
    },
    {
      "key": "authHeaderValue",
      "label": "Header Value",
      "type": "password",
      "placeholder": "Enter header value",
      "required": true,
      "displayOptions": {
        "show": { "authentication": ["headerAuth"] }
      }
    },
    {
      "key": "authJwtSecret",
      "label": "JWT Secret",
      "type": "password",
      "placeholder": "Enter JWT secret for verification",
      "required": true,
      "displayOptions": {
        "show": { "authentication": ["jwtAuth"] }
      }
    },
    {
      "key": "filterEvents",
      "label": "Filter Event Types",
      "type": "tags",
      "placeholder": "e.g., push, pull_request",
      "required": false,
      "default": []
    }
  ],
  "output": {
    "webhookPayload": {
      "timestamp": "ISO 8601 timestamp",
      "method": "HTTP method",
      "headers": "Request headers (sensitive ones redacted)",
      "body": "Request body",
      "query": "Query parameters",
      "raw": "Complete raw request data"
    }
  }
}
```

---

## Backend Authentication Handler

Add authentication validation to webhook routes:

**File:** `coreza-backend/src/routes/webhook.ts`

```typescript
function validateWebhookAuth(
  authMode: string,
  authConfig: Record<string, string>,
  headers: Record<string, string>
): { valid: boolean; error?: string } {
  switch (authMode) {
    case "none":
      return { valid: true };
      
    case "basicAuth": {
      const authHeader = headers["authorization"];
      if (!authHeader?.startsWith("Basic ")) {
        return { valid: false, error: "Missing Basic Auth header" };
      }
      const encoded = authHeader.slice(6);
      const decoded = Buffer.from(encoded, "base64").toString();
      const [username, password] = decoded.split(":");
      if (username === authConfig.authUsername && 
          password === authConfig.authPassword) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid credentials" };
    }
    
    case "headerAuth": {
      const headerValue = headers[authConfig.authHeaderName?.toLowerCase()];
      if (headerValue === authConfig.authHeaderValue) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid header authentication" };
    }
    
    case "jwtAuth": {
      const authHeader = headers["authorization"];
      if (!authHeader?.startsWith("Bearer ")) {
        return { valid: false, error: "Missing Bearer token" };
      }
      // JWT verification logic using authConfig.authJwtSecret
      return { valid: true };
    }
    
    default:
      return { valid: true };
  }
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/nodes/WebhookTrigger.json` | Update fields with authentication options |
| `coreza-backend/src/routes/webhook.ts` | Add `validateWebhookAuth` helper function |

---

## Summary

- Adds 4 authentication modes: None, Basic Auth, Header Auth, JWT Auth
- Conditional fields appear based on selected authentication type
- Backend validates incoming webhook requests based on node configuration
- Removes path, respondMode, secret, and responseHeaders (can add later if needed)
- Changes default HTTP method from "ALL" to "POST"

