/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { createHmac } from "crypto";
import axios from "axios";

export interface WebhookProviderConfig {
  id: string;
  name: string;
  incomingPath: string; // e.g., 'generic' or 'telegram'

  verification: {
    headerName?: string; // e.g., 'x-telegram-bot-api-secret-token'
    method: "none" | "direct" | "hmac-sha256" | "hmac-sha1";
  };

  // For providers that require verification challenge (WhatsApp hub.challenge)
  verifyChallenge?: (query: Record<string, any>) => { valid: boolean; challenge?: string };

  externalApi?: {
    setWebhook?: (params: {
      creds: object;
      callbackUrl: string;
      secretToken?: string;
      allowedUpdates?: string[];
    }) => Promise<{ success: boolean; description?: string }>;

    deleteWebhook?: (botToken: string) => Promise<boolean>;

    getWebhookInfo?: (botToken: string) => Promise<any>;
  };

  normalizePayload: (params: {
    method: string;
    headers: Record<string, any>;
    body: any;
    query: Record<string, any>;
  }) => any;
}

export const WEBHOOK_PROVIDERS: Record<string, WebhookProviderConfig> = {
  generic: {
    id: "generic",
    name: "Generic Webhook",
    incomingPath: "generic",
    verification: {
      method: "hmac-sha256",
      headerName: "x-webhook-signature",
    },
    normalizePayload: ({ method, headers, body, query }) => ({
      timestamp: new Date().toISOString(),
      method,
      headers: {
        ...headers,
        authorization: headers.authorization ? "[REDACTED]" : undefined,
      },
      body,
      query,
      raw: { method, headers, body, query },
    }),
  },

  telegram: {
    id: "telegram",
    name: "Telegram Bot",
    incomingPath: "telegram",
    verification: {
      method: "direct",
      headerName: "x-telegram-bot-api-secret-token",
    },
    externalApi: {
      setWebhook: async ({
        creds,
        callbackUrl,
        secretToken,
        allowedUpdates,
      }) => {
        try {
          const botToken = creds.bot_token;
          const url = `https://api.telegram.org/bot${botToken}/setWebhook`;
          const payload: any = {
            url: callbackUrl,
            allowed_updates: allowedUpdates || [],
          };

          if (secretToken) {
            payload.secret_token = secretToken;
          }

          const response = await axios.post(url, payload);

          return {
            success: response.data.ok,
            description: response.data.description,
          };
        } catch (error: any) {
          return {
            success: false,
            description: error.response?.data?.description || error.message,
          };
        }
      },

      deleteWebhook: async (botToken: string) => {
        try {
          const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
          const response = await axios.post(url);
          return response.data.ok;
        } catch (error) {
          return false;
        }
      },

      getWebhookInfo: async (botToken: string) => {
        try {
          const url = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
          const response = await axios.get(url);
          return response.data.result;
        } catch (error) {
          return null;
        }
      },
    },
    normalizePayload: ({ body }) => {
      const update = body;

      // Extract message type
      const updateType = update.message
        ? "message"
        : update.edited_message
        ? "edited_message"
        : update.channel_post
        ? "channel_post"
        : update.edited_channel_post
        ? "edited_channel_post"
        : update.callback_query
        ? "callback_query"
        : update.inline_query
        ? "inline_query"
        : "unknown";

      // Extract chat and from
      const messageObj =
        update.message ||
        update.edited_message ||
        update.channel_post ||
        update.edited_channel_post;
      const chat = messageObj?.chat || update.callback_query?.message?.chat;
      const from =
        messageObj?.from ||
        update.callback_query?.from ||
        update.inline_query?.from;

      // Extract text
      const text =
        messageObj?.text ||
        messageObj?.caption ||
        update.callback_query?.data ||
        update.inline_query?.query;

      return {
        timestamp: new Date().toISOString(),
        updateType,
        update_id: update.update_id,
        message: update.message,
        edited_message: update.edited_message,
        channel_post: update.channel_post,
        callback_query: update.callback_query,
        inline_query: update.inline_query,
        chat,
        from,
        text,
        raw: update,
      };
    },
  },

  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp Cloud API",
    incomingPath: "whatsapp",
    verification: {
      method: "hmac-sha256",
      headerName: "x-hub-signature-256",
    },
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
        statuses: value?.statuses,
        metadata: value?.metadata,
        contacts: value?.contacts,
        raw: body,
      };
    },
  },
};

export function getProviderConfig(
  providerId: string
): WebhookProviderConfig | null {
  return WEBHOOK_PROVIDERS[providerId] || null;
}

export function verifyProviderSignature(
  provider: WebhookProviderConfig,
  secret: string,
  headers: Record<string, any>,
  body: any
): boolean {
  if (provider.verification.method === "none") {
    return true;
  }

  if (provider.verification.method === "direct") {
    const headerToken = headers[provider.verification.headerName || ""];
    return secret === headerToken;
  }

  // HMAC verification
  const signatureHeader =
    headers[provider.verification.headerName || "x-webhook-signature"];
  if (!signatureHeader) {
    return false;
  }

  try {
    const algorithm =
      provider.verification.method === "hmac-sha1" ? "sha1" : "sha256";
    const prefix = algorithm === "sha1" ? "sha1=" : "sha256=";

    let expectedSignature = signatureHeader;
    if (signatureHeader.startsWith(prefix)) {
      expectedSignature = signatureHeader.slice(prefix.length);
    }

    const hmac = createHmac(algorithm, secret);
    hmac.update(JSON.stringify(body));
    const calculatedSignature = hmac.digest("hex");

    return calculatedSignature === expectedSignature;
  } catch (error) {
    return false;
  }
}
