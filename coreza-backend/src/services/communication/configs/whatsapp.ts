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

import { CommunicationConfig } from "../types";

const API_VERSION = "v17.0";

export const whatsappConfig: CommunicationConfig = {
  serviceKey: "whatsapp",
  authType: "token",
  credentialFields: ["access_token", "phone_number_id"],

  baseUrl: (creds) =>
    `https://graph.facebook.com/${API_VERSION}/${creds.phone_number_id}`,

  validateCredentials: async (creds) => {
    if (!creds.access_token || !creds.phone_number_id) {
      return {
        valid: false,
        error: "access_token and phone_number_id are required",
      };
    }
    return { valid: true };
  },

  makeAuthHeaders: (creds) => ({
    Authorization: `Bearer ${creds.access_token}`,
    "Content-Type": "application/json",
  }),

  operations: {
    send_message: {
      method: "post",
      path: "/messages",
      validateInput: (input) => {
        if (!input.to || !input.message) {
          return { valid: false, error: "to and message are required" };
        }
        return { valid: true };
      },
      makeBody: (input) => ({
        messaging_product: "whatsapp",
        to: input.to,
        type: input.type || "text",
        text: { body: input.message },
      }),
      transformResult: (data) => ({
        success: true,
        messageId: data.messages[0].id,
        message: "WhatsApp message sent successfully",
      }),
    },

    send_template: {
      method: "post",
      path: "/messages",
      validateInput: (input) => {
        if (!input.to || !input.template_name) {
          return { valid: false, error: "to and template_name are required" };
        }
        return { valid: true };
      },
      makeBody: (input) => {
        const parameters = input.parameters || [];
        return {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.template_name,
            language: { code: input.language_code || "en_US" },
            components:
              parameters.length > 0
                ? [
                    {
                      type: "body",
                      parameters: parameters.map((param: string) => ({
                        type: "text",
                        text: param,
                      })),
                    },
                  ]
                : [],
          },
        };
      },
      transformResult: (data) => ({
        success: true,
        messageId: data.messages[0].id,
        message: "WhatsApp template message sent successfully",
      }),
    },

    send_media: {
      method: "post",
      path: "/messages",
      validateInput: (input) => {
        if (!input.to || !input.media_type || !input.media_url) {
          return {
            valid: false,
            error: "to, media_type, and media_url are required",
          };
        }
        return { valid: true };
      },
      makeBody: (input) => ({
        messaging_product: "whatsapp",
        to: input.to,
        type: input.media_type,
        [input.media_type]: {
          link: input.media_url,
          caption: input.caption || "",
        },
      }),
      transformResult: (data) => ({
        success: true,
        messageId: data.messages[0].id,
        message: "WhatsApp media message sent successfully",
      }),
    },

    get_templates: {
      method: "get",
      path: "/message_templates",
      transformResult: (data) => data,
    },
  },
};
