import express from "express";
import CredentialManager from "../utils/credentialManager";
import { createLogger } from "../utils/logger";
import axios from "axios";

const router = express.Router();
const logger = createLogger("telegram-routes");

/**
 * Store Telegram bot credentials
 */
router.post("/credentials", async (req, res) => {
  try {
    const { user_id, credential_name, bot_token } = req.body;

    if (!user_id || !credential_name || !bot_token) {
      return res.status(400).json({
        success: false,
        error: "user_id, credential_name, and bot_token are required",
      });
    }

    // Validate bot token by calling Telegram's getMe API
    try {
      const cleanToken = bot_token.trim();
      const validateUrl = `https://api.telegram.org/bot${cleanToken}/getMe`;
      const validateResponse = await axios.get(validateUrl);

      if (!validateResponse.data.ok) {
        return res.status(400).json({
          success: false,
          error: "Invalid bot token",
        });
      }

      logger.info(
        { botUsername: validateResponse.data.result.username },
        "Telegram bot validated"
      );
    } catch (error: any) {
      logger.error({ err: error }, "Failed to validate Telegram bot token");
      return res.status(400).json({
        success: false,
        error: "Invalid bot token or unable to connect to Telegram API",
      });
    }

    // Store credentials
    const credentialId = await CredentialManager.storeCredentials(
      user_id,
      "telegram",
      credential_name,
      bot_token
    );

    logger.info(
      { userId: user_id, credentialId },
      "Telegram credentials stored"
    );

    res.json({
      success: true,
      credential_id: credentialId,
      message: "Telegram bot credentials saved successfully",
    });
  } catch (error) {
    logger.error({ err: error }, "Error storing Telegram credentials");
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
