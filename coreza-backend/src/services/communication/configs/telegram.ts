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

import axios from "axios";
import { CommunicationConfig } from "../types";

export const telegramConfig: CommunicationConfig = {
  serviceKey: "telegram",
  authType: "token",
  credentialFields: ["bot_token"],

  baseUrl: (creds) => `https://api.telegram.org/bot${creds.bot_token}`,

  validateCredentials: async (creds) => {
    if (!creds.bot_token) {
      return { valid: false, error: "bot_token is required" };
    }

    const cleanToken = creds.bot_token.trim();
    const response = await axios.get(
      `https://api.telegram.org/bot${cleanToken}/getMe`
    );

    if (!response.data.ok) {
      return { valid: false, error: "Invalid bot token" };
    }

    return { valid: true };
  },

  makeAuthHeaders: () => ({
    "Content-Type": "application/json",
  }),

  operations: {
    send_message: {
      method: "post",
      path: "/sendMessage",
      validateInput: (input) => {
        if (!input.chat_id || !input.message) {
          return { valid: false, error: "chat_id and message are required" };
        }
        return { valid: true };
      },
      makeBody: (input) => ({
        chat_id: input.chat_id,
        text: input.message,
        parse_mode: input.parse_mode || "HTML",
      }),
      transformResult: (data) => ({
        success: true,
        message_id: data.result.message_id,
        chat_id: data.result.chat.id,
        message: "Telegram message sent successfully",
      }),
    },

    send_photo: {
      method: "post",
      path: "/sendPhoto",
      validateInput: (input) => {
        if (!input.chat_id || !input.photo_url) {
          return { valid: false, error: "chat_id and photo_url are required" };
        }
        return { valid: true };
      },
      makeBody: (input) => ({
        chat_id: input.chat_id,
        photo: input.photo_url,
        caption: input.caption || "",
        parse_mode: input.parse_mode || "HTML",
      }),
      transformResult: (data) => ({
        success: true,
        message_id: data.result.message_id,
        chat_id: data.result.chat.id,
        message: "Telegram photo sent successfully",
      }),
    },

    send_document: {
      method: "post",
      path: "/sendDocument",
      validateInput: (input) => {
        if (!input.chat_id || !input.document_url) {
          return { valid: false, error: "chat_id and document_url are required" };
        }
        return { valid: true };
      },
      makeBody: (input) => ({
        chat_id: input.chat_id,
        document: input.document_url,
        caption: input.caption || "",
        parse_mode: input.parse_mode || "HTML",
      }),
      transformResult: (data) => ({
        success: true,
        message_id: data.result.message_id,
        chat_id: data.result.chat.id,
        message: "Telegram document sent successfully",
      }),
    },
  },
};
