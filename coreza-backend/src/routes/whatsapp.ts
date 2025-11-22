import express from "express";
import { CommunicationService } from "../services/communications";
import { QueueManager } from "../services/queueManager";

const DEFAULT_WHATSAPP_USER_ID = process.env.WHATSAPP_DEFAULT_USER_ID;
const DEFAULT_WHATSAPP_CREDENTIAL_ID =
  process.env.WHATSAPP_DEFAULT_CREDENTIAL_ID;

const router = express.Router();

// Webhook verification (GET)
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

// Webhook event handling (POST)
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

        // // Queue message processing
        // await QueueManager.addNotification({
        //   userId: 'system', // TODO: Map phone number to user ID
        //   type: 'websocket',
        //   data: {
        //     type: 'whatsapp_message_received',
        //     from: phoneNumber,
        //     message: messageText,
        //     messageType,
        //     timestamp: new Date().toISOString()
        //   }
        // });

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

// Send WhatsApp message
router.post("/send", async (req, res, next) => {
  try {
    const { user_id, credential_id, to, message, type = "text" } = req.body;

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
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
    const {
      user_id,
      credential_id,
      to,
      template_name,
      language_code = "en_US",
      parameters = [],
    } = req.body;

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
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
    const {
      user_id,
      credential_id,
      to,
      media_type,
      media_url,
      caption = "",
    } = req.body;

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
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
    const user_id = req.query.user_id as string | undefined;
    const credential_id = req.query.credential_id as string | undefined;

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
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
