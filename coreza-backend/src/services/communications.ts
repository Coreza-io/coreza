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
import axios from "axios";
import { createError } from "../middleware/errorHandler";
import CredentialManager from "../utils/credentialManager";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../utils/normalizeOutput";
import type { StandardNodeOutput } from "../types/nodeOutput";

export interface CommunicationInput {
  user_id?: string;
  userId?: string;
  credential_id?: string;
  credentialId?: string;
  [key: string]: any;
}

export interface CommunicationResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Base communication service class
abstract class BaseCommunicationService {
  protected abstract serviceName: string;

  abstract execute(
    operation: string,
    input: CommunicationInput,
  ): Promise<StandardNodeOutput>;
}

// Gmail service
class GmailService extends BaseCommunicationService {
  protected serviceName = "gmail";

  private normalizeIds(input: CommunicationInput): {
    userId?: string;
    credentialId?: string;
  } {
    return {
      userId: input.user_id ?? input.userId,
      credentialId: input.credential_id ?? input.credentialId,
    };
  }

  private createGmailAuth(credentials: any): any {
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri,
    );

    if (credentials.refresh_token) {
      auth.setCredentials({
        refresh_token: credentials.refresh_token,
        //access_token: credentials.access_token,
      });
    }

    return auth;
  }

  async execute(
    operation: string,
    input: CommunicationInput,
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "Gmail", category: "communication" };
    try {
      const { userId, credentialId } = this.normalizeIds(input);

      if (operation === "list_credentials") {
        if (!userId) {
          throw createError("user_id is required", 400);
        }
        const creds = await CredentialManager.listCredentials(userId, "gmail");
        return createSuccessOutput(creds, context);
      }

      if (!userId || !credentialId) {
        throw createError("user_id and credential_id are required", 400);
      }

      // Use CredentialManager instead of custom method
      const result = await CredentialManager.getCredentials(
        userId,
        "gmail",
        credentialId,
      );

      if (!result.credentials) {
        throw createError("Gmail credentials not found", 404);
      }

      // Flatten credentials structure
      const credentials = {
        ...result.credentials.client_json,
        ...result.credentials.token_json,
      };
      const auth = this.createGmailAuth(credentials);
      const gmail = google.gmail({ version: "v1", auth });

      let operationResult;
      switch (operation) {
        case "send":
        case "send_email":
          operationResult = await this.sendEmail(gmail, input);
          break;
        case "messages":
        case "get_messages":
          operationResult = await this.getMessages(gmail, input);
          break;
        case "message":
        case "get_message":
          operationResult = await this.getMessage(gmail, input);
          break;
        default:
          throw createError(`Unsupported Gmail operation: ${operation}`, 400);
      }

      return createSuccessOutput(operationResult, context);
    } catch (error: any) {
      if (error.response?.status === 401) {
        return createErrorOutput(
          "Gmail authentication expired. Please re-authorize.",
          context,
        );
      }
      return createErrorOutput(error, context);
    }
  }

  private async sendEmail(gmail: any, input: CommunicationInput): Promise<any> {
    const { to, subject, body, html } = input;

    if (!to || !subject || !body) {
      throw createError("Missing required parameters", 400);
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
      requestBody: {
        raw: encodedMessage,
      },
    });

    return {
      success: true,
      messageId: result.data.id,
      message: "Email sent successfully",
    };
  }

  private async getMessages(
    gmail: any,
    input: CommunicationInput,
  ): Promise<any> {
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

  private async getMessage(
    gmail: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { messageId } = input;

    const messageDetail = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    // Extract email content
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
}

// WhatsApp service
class WhatsAppService extends BaseCommunicationService {
  protected serviceName = "whatsapp";
  private apiVersion = "v17.0";

  private normalizeIds(input: CommunicationInput): {
    userId?: string;
    credentialId?: string;
  } {
    return {
      userId: input.user_id ?? input.userId,
      credentialId: input.credential_id ?? input.credentialId,
    };
  }

  async execute(
    operation: string,
    input: CommunicationInput,
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "WhatsApp", category: "communication" };
    try {
      const { userId, credentialId } = this.normalizeIds(input);
      let credentials: any = null;

      if (
        [
          "send",
          "send_message",
          "send_template",
          "send_media",
          "get_templates",
        ].includes(operation)
      ) {
        if (!userId || !credentialId) {
          throw createError("user_id and credential_id are required", 400);
        }
        // Use CredentialManager instead of custom method
        const result = await CredentialManager.getCredentials(
          userId,
          "whatsapp",
          credentialId,
        );

        if (!result.credentials) {
          throw createError("WhatsApp credentials not found", 404);
        }

        // Flatten credentials structure
        credentials = {
          ...result.credentials.client_json,
          ...result.credentials.token_json,
        };
      }

      let operationResult;
      switch (operation) {
        case "send":
        case "send_message":
          operationResult = await this.sendMessage(credentials, input);
          break;
        case "send_template":
          operationResult = await this.sendTemplate(credentials, input);
          break;
        case "send_media":
          operationResult = await this.sendMedia(credentials, input);
          break;
        case "get_templates":
          operationResult = await this.listTemplates(credentials);
          break;
        case "verify_webhook":
          operationResult = this.verifyWebhook(input);
          break;
        default:
          throw createError(
            `Unsupported WhatsApp operation: ${operation}`,
            400,
          );
      }

      return createSuccessOutput(operationResult, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  private async sendMessage(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { to, message, type = "text" } = input;

    if (!to || !message) {
      throw createError("to and message are required", 400);
    }

    const payload = {
      messaging_product: "whatsapp",
      to,
      type,
      text: {
        body: message,
      },
    };

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: "WhatsApp message sent successfully",
    };
  }

  private async sendTemplate(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const {
      to,
      template_name,
      language_code = "en_US",
      parameters = [],
    } = input;

    if (!to || !template_name) {
      throw createError("to and template_name are required", 400);
    }

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template_name,
        language: {
          code: language_code,
        },
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

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: "WhatsApp template message sent successfully",
    };
  }

  private async sendMedia(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { to, media_type, media_url, caption = "" } = input;

    if (!to || !media_type || !media_url) {
      throw createError("to, media_type, and media_url are required", 400);
    }

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: media_type,
      [media_type]: {
        link: media_url,
        caption: caption,
      },
    };

    const response = await axios.post(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      message: "WhatsApp media message sent successfully",
    };
  }

  private verifyWebhook(input: CommunicationInput) {
    const mode = input.mode;
    const token = input.token;
    const challenge = input.challenge;

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { verified: true, challenge };
    }

    return { verified: false };
  }

  private async listTemplates(credentials: any): Promise<any> {
    const response = await axios.get(
      `https://graph.facebook.com/${this.apiVersion}/${credentials.phone_number_id}/message_templates`,
      {
        headers: {
          Authorization: `Bearer ${credentials.access_token}`,
        },
      },
    );
    return response.data;
  }
}

// Telegram service
class TelegramService extends BaseCommunicationService {
  protected serviceName = "telegram";

  private normalizeIds(input: CommunicationInput): {
    userId?: string;
    credentialId?: string;
  } {
    return {
      userId: input.user_id ?? input.userId,
      credentialId: input.credential_id ?? input.credentialId,
    };
  }

  async execute(
    operation: string,
    input: CommunicationInput,
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "Telegram", category: "communication" };
    try {
      const { userId, credentialId } = this.normalizeIds(input);

      if (!userId || !credentialId) {
        throw createError("user_id and credential_id are required", 400);
      }

      // Get bot_token from credentials
      const result = await CredentialManager.getCredentials(
        userId,
        "telegram",
        credentialId,
      );

      if (!result.credentials) {
        throw createError("Telegram credentials not found", 404);
      }

      const credentials = result.credentials;

      let operationResult;
      switch (operation) {
        case "send_message":
          operationResult = await this.sendMessage(credentials, input);
          break;
        case "send_photo":
          operationResult = await this.sendPhoto(credentials, input);
          break;
        case "send_document":
          operationResult = await this.sendDocument(credentials, input);
          break;
        default:
          throw createError(
            `Unsupported Telegram operation: ${operation}`,
            400,
          );
      }

      return createSuccessOutput(operationResult, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  private async sendMessage(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { chat_id, message, parse_mode = "HTML" } = input;

    if (!chat_id || !message) {
      throw createError("chat_id and message are required", 400);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${credentials.client_json.bot_token}/sendMessage`,
      {
        chat_id,
        text: message,
        parse_mode,
      },
    );

    if (!response.data.ok) {
      throw createError(
        response.data.description || "Failed to send Telegram message",
        400,
      );
    }

    return {
      success: true,
      message_id: response.data.result.message_id,
      chat_id: response.data.result.chat.id,
      message: "Telegram message sent successfully",
    };
  }

  private async sendPhoto(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { chat_id, photo_url, caption = "", parse_mode = "HTML" } = input;

    if (!chat_id || !photo_url) {
      throw createError("chat_id and photo_url are required", 400);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${credentials.bot_token}/sendPhoto`,
      {
        chat_id,
        photo: photo_url,
        caption,
        parse_mode,
      },
    );

    if (!response.data.ok) {
      throw createError(
        response.data.description || "Failed to send Telegram photo",
        400,
      );
    }

    return {
      success: true,
      message_id: response.data.result.message_id,
      chat_id: response.data.result.chat.id,
      message: "Telegram photo sent successfully",
    };
  }

  private async sendDocument(
    credentials: any,
    input: CommunicationInput,
  ): Promise<any> {
    const { chat_id, document_url, caption = "", parse_mode = "HTML" } = input;

    if (!chat_id || !document_url) {
      throw createError("chat_id and document_url are required", 400);
    }

    const response = await axios.post(
      `https://api.telegram.org/bot${credentials.bot_token}/sendDocument`,
      {
        chat_id,
        document: document_url,
        caption,
        parse_mode,
      },
    );

    if (!response.data.ok) {
      throw createError(
        response.data.description || "Failed to send Telegram document",
        400,
      );
    }

    return {
      success: true,
      message_id: response.data.result.message_id,
      chat_id: response.data.result.chat.id,
      message: "Telegram document sent successfully",
    };
  }
}

// Main communication service
export class CommunicationService {
  private static gmailService = new GmailService();
  private static whatsappService = new WhatsAppService();
  private static telegramService = new TelegramService();

  static async execute(
    service: string,
    operation: string,
    input: CommunicationInput,
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: service, category: "communication" };
    switch (service.toLowerCase()) {
      case "gmail":
        return this.gmailService.execute(operation, input);
      case "whatsapp":
        return this.whatsappService.execute(operation, input);
      case "telegram":
        return this.telegramService.execute(operation, input);
      default:
        return createErrorOutput(
          `Unsupported communication service: ${service}`,
          context,
        );
    }
  }
}
