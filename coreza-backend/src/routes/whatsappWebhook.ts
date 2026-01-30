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

import express from "express";
import { CommunicationService } from "../services/communications";

const DEFAULT_WHATSAPP_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID;
const DEFAULT_WHATSAPP_CREDENTIAL_ID = process.env.WHATSAPP_DEFAULT_CREDENTIAL_ID;

const router = express.Router();

/**
 * Webhook verification (GET) - Must be public for WhatsApp to verify
 * GET /whatsapp/webhook
 */
router.get("/webhook", async (req, res) => {
  const {
    "hub.mode": mode,
    "hub.verify_token": token,
    "hub.challenge": challenge,
  } = req.query;

  const result = await CommunicationService.execute(
    "whatsapp",
    "verify_webhook",
    {
      user_id: DEFAULT_WHATSAPP_USER_ID ?? "system",
      credential_id: DEFAULT_WHATSAPP_CREDENTIAL_ID ?? "webhook",
      mode: mode as string,
      token: token as string,
      challenge: challenge as string,
    }
  );

  if (result.success) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

/**
 * Webhook event handling (POST) - Must be public for WhatsApp to send events
 * POST /whatsapp/webhook
 */
router.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field === "messages") {
            await handleWhatsAppMessage(change.value);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.sendStatus(500);
  }
});

/**
 * Handle incoming WhatsApp messages
 */
async function handleWhatsAppMessage(value: any): Promise<void> {
  try {
    if (value.messages) {
      for (const message of value.messages) {
        const phoneNumber = message.from;
        const messageText = message.text?.body || "";

        console.log(
          `📱 Received WhatsApp message from ${phoneNumber}: ${messageText}`
        );

        // Auto-reply example
        if (
          messageText.toLowerCase().includes("hello") &&
          DEFAULT_WHATSAPP_USER_ID &&
          DEFAULT_WHATSAPP_CREDENTIAL_ID
        ) {
          await CommunicationService.execute("whatsapp", "send_message", {
            user_id: DEFAULT_WHATSAPP_USER_ID,
            credential_id: DEFAULT_WHATSAPP_CREDENTIAL_ID,
            to: phoneNumber,
            message: "Hello! How can I help you today?",
          });
        }
      }
    }

    // Handle message status updates
    if (value.statuses) {
      for (const status of value.statuses) {
        console.log(
          `📊 WhatsApp message status: ${status.status} for ${status.id}`
        );
      }
    }
  } catch (error) {
    console.error("Error handling WhatsApp message:", error);
  }
}

export default router;
