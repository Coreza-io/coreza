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

import { google, gmail_v1 } from "googleapis";
import { CommunicationConfig, CommunicationInput } from "../types";

// Gmail uses OAuth and requires the Google SDK for proper handling
// This config uses customExecute for full control

function createGmailAuth(credentials: any): any {
  const auth = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uri
  );

  if (credentials.refresh_token) {
    auth.setCredentials({
      refresh_token: credentials.refresh_token,
    });
  }

  return auth;
}

async function sendEmail(gmail: gmail_v1.Gmail, input: CommunicationInput) {
  const { to, subject, body, html } = input;

  if (!to || !subject || !body) {
    throw new Error("to, subject, and body are required");
  }

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html || body,
  ].join("\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });

  return {
    success: true,
    messageId: result.data.id,
    message: "Email sent successfully",
  };
}

async function getMessages(gmail: gmail_v1.Gmail, input: CommunicationInput) {
  const { query, max_results = 10 } = input;

  const listResult = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: max_results,
  });

  const messages = [];

  if (listResult.data.messages) {
    for (const msg of listResult.data.messages.slice(0, max_results)) {
      try {
        const messageDetail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
        });

        const headers: gmail_v1.Schema$MessagePartHeader[] =
          messageDetail.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((header) => header.name === name)?.value || "";

        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          snippet: messageDetail.data.snippet,
          from: getHeader("From"),
          to: getHeader("To"),
          subject: getHeader("Subject"),
          date: getHeader("Date"),
          labels: messageDetail.data.labelIds,
        });
      } catch (error) {
        console.error(`Error fetching message ${msg.id}:`, error);
      }
    }
  }

  return {
    messages,
    resultSizeEstimate: listResult.data.resultSizeEstimate,
  };
}

async function getMessage(gmail: gmail_v1.Gmail, input: CommunicationInput) {
  const { messageId } = input;

  const messageDetail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const extractContent = (part: any): { text?: string; html?: string } => {
    const content: any = {};

    if (part.body?.data) {
      const decodedContent = Buffer.from(part.body.data, "base64").toString();
      if (part.mimeType === "text/plain") {
        content.text = decodedContent;
      } else if (part.mimeType === "text/html") {
        content.html = decodedContent;
      }
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        Object.assign(content, extractContent(subPart));
      }
    }

    return content;
  };

  const headers: gmail_v1.Schema$MessagePartHeader[] =
    messageDetail.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((header) => header.name === name)?.value || "";
  const content = extractContent(messageDetail.data.payload);

  return {
    id: messageDetail.data.id,
    threadId: messageDetail.data.threadId,
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    snippet: messageDetail.data.snippet,
    content: {
      text: content.text,
      html: content.html,
    },
    labels: messageDetail.data.labelIds,
  };
}

export const gmailConfig: CommunicationConfig = {
  serviceKey: "gmail",
  authType: "oauth",
  credentialFields: [], // Gmail uses OAuth flow, not manual credential entry
  baseUrl: "https://gmail.googleapis.com/gmail/v1",

  makeAuthHeaders: async (creds) => ({
    Authorization: `Bearer ${creds.access_token}`,
    "Content-Type": "application/json",
  }),

  // Gmail requires Google SDK for proper OAuth handling
  customExecute: async (operation, input, creds) => {
    const auth = createGmailAuth(creds);
    const gmail = google.gmail({ version: "v1", auth });

    switch (operation) {
      case "send":
      case "send_email":
        return sendEmail(gmail, input);
      case "messages":
      case "get_messages":
        return getMessages(gmail, input);
      case "message":
      case "get_message":
        return getMessage(gmail, input);
      default:
        throw new Error(`Unsupported Gmail operation: ${operation}`);
    }
  },

  // Operations defined for documentation purposes (actual execution via customExecute)
  operations: {
    send: {
      method: "post",
      path: "/users/me/messages/send",
    },
    get_messages: {
      method: "get",
      path: "/users/me/messages",
    },
    get_message: {
      method: "get",
      path: (input) => `/users/me/messages/${input.messageId}`,
    },
  },
};
