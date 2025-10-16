import express from "express";
import { AlpacaNewsWebSocketClient } from "../services/websockets/AlpacaNewsWebSocketClient";
import CredentialManager from "../utils/credentialManager";

const router = express.Router();

/**
 * Subscribe to Alpaca news for specific symbols
 * POST /alpaca-news/subscribe
 */
router.post("/subscribe", async (req, res) => {
  try {
    const { user_id, credential_id, symbols } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    if (!symbols) {
      return res.status(400).json({ error: "symbols is required" });
    }

    // Parse symbols (comma-separated string or array)
    const symbolArray =
      typeof symbols === "string"
        ? symbols
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : Array.isArray(symbols)
        ? symbols
        : [];

    if (symbolArray.length === 0) {
      return res.status(400).json({ error: "At least one symbol is required" });
    }

    // Get credentials
    const credential = await CredentialManager.getCredentials(
      user_id,
      "alpaca",
      credential_id
    );

    if (!credential) {
      return res.status(404).json({ error: "Credential not found" });
    }

    const {
      credentials: { client_json, token_json },
    } = await CredentialManager.getCredentials(
      user_id,
      "alpaca",
      credential_id
    );

    const { api_key, secret_key } = client_json;
    if (!api_key || !secret_key) {
      return res.status(400).json({ error: "Invalid Alpaca credentials" });
    }

    // Get or create WebSocket client
    const client = AlpacaNewsWebSocketClient.getInstance();

    // Connect if not already connected
    if (!client.isReady()) {
      await client.connect({ api_key, secret_key });
    }

    // Subscribe to symbols
    await client.subscribe(user_id, symbolArray);

    res.json({
      success: true,
      message: `Subscribed to news for: ${symbolArray.join(", ")}`,
      symbols: symbolArray,
      subscriptions: client.getUserSubscriptions(user_id),
    });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Subscription failed",
    });
  }
});

/**
 * Unsubscribe from Alpaca news for specific symbols
 * POST /alpaca-news/unsubscribe
 */
router.post("/unsubscribe", async (req, res) => {
  try {
    const { user_id, symbols } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (!symbols) {
      return res.status(400).json({ error: "symbols is required" });
    }

    // Parse symbols
    const symbolArray =
      typeof symbols === "string"
        ? symbols
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : Array.isArray(symbols)
        ? symbols
        : [];

    if (symbolArray.length === 0) {
      return res.status(400).json({ error: "At least one symbol is required" });
    }

    const client = AlpacaNewsWebSocketClient.getInstance();
    await client.unsubscribe(user_id, symbolArray);

    res.json({
      success: true,
      message: `Unsubscribed from news for: ${symbolArray.join(", ")}`,
      symbols: symbolArray,
      subscriptions: client.getUserSubscriptions(user_id),
    });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unsubscribe failed",
    });
  }
});

/**
 * Get current subscription status
 * GET /alpaca-news/status
 */
router.get("/status", (req, res) => {
  try {
    const client = AlpacaNewsWebSocketClient.getInstance();
    const stats = client.getStats();

    res.json({
      success: true,
      status: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Status check failed",
    });
  }
});

/**
 * Get user's subscriptions
 * GET /alpaca-news/subscriptions/:userId
 */
router.get("/subscriptions/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const client = AlpacaNewsWebSocketClient.getInstance();
    const subscriptions = client.getUserSubscriptions(userId);

    res.json({
      success: true,
      userId,
      subscriptions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get subscriptions",
    });
  }
});

export default router;
