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
import CredentialManager from "../utils/credentialManager";
import { requireAuth } from "../middleware/jwtAuth";

const DEFAULT_WHATSAPP_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID;
const DEFAULT_WHATSAPP_CREDENTIAL_ID =
  process.env.WHATSAPP_DEFAULT_CREDENTIAL_ID;

const router = express.Router();

// Webhook verification (GET) - Must be public for WhatsApp to verify
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

// Webhook event handling (POST) - Must be public for WhatsApp to send events
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

// Handle incoming WhatsApp messages
async function handleWhatsAppMessage(value: any): Promise<void> {
  try {
    if (value.messages) {
      for (const message of value.messages) {
        const phoneNumber = message.from;
        const messageText = message.text?.body || "";
        const messageType = message.type;

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

// Apply JWT authentication to all routes below this point
router.use(requireAuth);

// Save WhatsApp credentials
router.post("/credentials", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_name, access_token, phone_number_id } = req.body;

    if (!credential_name || !access_token || !phone_number_id) {
      return res.status(400).json({
        error:
          "credential_name, access_token, and phone_number_id are required",
      });
    }

    const credentialId = await CredentialManager.saveCredentials(
      user_id,
      "whatsapp",
      credential_name,
      {
        access_token,
        phone_number_id,
      }
    );

    res.json({
      success: true,
      credential_id: credentialId,
      message: "WhatsApp credentials saved successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp message
router.post("/send", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_id, to, message, type = "text" } = req.body;

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    const result = await CommunicationService.execute(
      "whatsapp",
      "send_message",
      {
        user_id,
        credential_id,
        to,
        message,
        type,
      }
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp template message
router.post("/send-template", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      credential_id,
      to,
      template_name,
      language_code = "en_US",
      parameters = [],
    } = req.body;

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    const result = await CommunicationService.execute(
      "whatsapp",
      "send_template",
      {
        user_id,
        credential_id,
        to,
        template_name,
        language_code,
        parameters,
      }
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Send WhatsApp media message
router.post("/send-media", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      credential_id,
      to,
      media_type,
      media_url,
      caption = "",
    } = req.body;

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    const result = await CommunicationService.execute(
      "whatsapp",
      "send_media",
      {
        user_id,
        credential_id,
        to,
        media_type,
        media_url,
        caption,
      }
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get WhatsApp message templates
router.get("/templates", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from query params
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const credential_id = req.query.credential_id as string | undefined;

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    const result = await CommunicationService.execute(
      "whatsapp",
      "get_templates",
      {
        user_id,
        credential_id,
      }
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
