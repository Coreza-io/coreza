import express from "express";
import axios from "axios";
import { WebSocketClient } from "../services/WebSocketClient";
import CredentialManager from "../utils/credentialManager";

const router = express.Router();

/**
 * Subscribe to Alpaca news for specific symbols
 * POST /alpaca-news/subscribe
 */

/**
 * Subscribe to Alpaca news for specific symbols
 * POST /alpaca-news/subscribe
 */
router.post("/subscribe", async (req, res) => {
  try {
    const { user_id, credential_id, symbols, node_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (!credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
    }

    if (!symbols) {
      return res.status(400).json({ error: "symbols is required" });
    }

    if (!node_id) {
      return res.status(400).json({ error: "node_id is required" });
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
    const credentialResponse = await CredentialManager.getCredentials(
      user_id,
      "alpaca",
      credential_id
    );

    if (!credentialResponse.credentials) {
      return res.status(404).json({ error: "Credential not found" });
    }

    const {
      credentials: { client_json, token_json },
    } = credentialResponse;

    const { api_key, secret_key } = client_json;
    if (!api_key || !secret_key) {
      return res.status(400).json({ error: "Invalid Alpaca credentials" });
    }

    // Get or create WebSocket client
    const client = WebSocketClient.getInstance("alpaca_news");

    // Connect if not already connected
    if (!client.isReady()) {
      await client.connect({ api_key, secret_key });
    }

    // Subscribe to symbols
    await client.subscribe(user_id, symbolArray, { nodeId: node_id });

    res.json({
      success: true,
      message: `Subscribed to news for: ${symbolArray.join(", ")}`,
      symbols: symbolArray,
      node_id,
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
    const { user_id, symbols, node_id } = req.body;

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

    const client = WebSocketClient.getInstance("alpaca_news");
    await client.unsubscribe(user_id, symbolArray, {
      nodeId: node_id,
    });

    res.json({
      success: true,
      message: `Unsubscribed from news for: ${symbolArray.join(", ")}`,
      symbols: symbolArray,
      node_id: node_id ?? null,
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
    const client = WebSocketClient.getInstance("alpaca_news");
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
    const client = WebSocketClient.getInstance("alpaca_news");
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

/**
 * Convert date string to ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ)
 * Handles multiple input formats:
 * - "2025-11-06 01:30:00" -> "2025-11-06T01:30:00Z"
 * - "2025-11-06" -> "2025-11-06T00:00:00Z"
 * - "2025-11-06T01:30:00Z" -> "2025-11-06T01:30:00Z" (already ISO)
 */
const convertToISO8601 = (dateStr: string): string => {
  if (!dateStr || dateStr.trim() === "") return dateStr;
  
  const trimmed = dateStr.trim();
  
  // Already in ISO 8601 format (has T and ends with Z)
  if (trimmed.includes('T') && trimmed.endsWith('Z')) {
    return trimmed;
  }
  
  // Format: "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD HH:mm:ss.SSS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)) {
    // Replace space with T and add Z
    return trimmed.replace(' ', 'T') + 'Z';
  }
  
  // Format: "YYYY-MM-DD" (date only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }
  
  // Fallback: try parsing as Date and convert to ISO
  try {
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (error) {
    console.error('Date conversion error:', error);
  }
  
  // Return original if we can't convert
  return trimmed;
};

/**
 * Fetch historical news articles from Alpaca REST API
 * POST /alpaca-news/fetch
 */
router.post("/fetch", async (req, res) => {
  try {
    const { user_id, credential_id, symbols, start, end, limit, sort, page_token, include_content } = req.body;

    // Validation
    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    if (!credential_id) return res.status(400).json({ error: "credential_id is required" });

    // Get credentials
    const credential = await CredentialManager.getCredentials(user_id, "alpaca", credential_id);
    if (!credential.credentials)
      return res.status(404).json({ error: "Credential not found" });

    const { credentials: { client_json } } = credential;
    const { api_key, secret_key } = client_json;
    if (!api_key || !secret_key) {
      return res.status(400).json({ error: "Invalid Alpaca credentials" });
    }

    // Build query parameters
    const params: any = {};
    if (symbols) {
      const symbolArray = typeof symbols === "string" 
        ? symbols.split(",").map((s: string) => s.trim()).filter(Boolean)
        : Array.isArray(symbols) ? symbols : [];
      if (symbolArray.length > 0) {
        params.symbols = symbolArray.join(",");
      }
    }
    if (start && start.trim() !== "") params.start = convertToISO8601(start);
    if (end && end.trim() !== "") params.end = convertToISO8601(end);
    if (limit && limit.toString().trim() !== "") {
      const limitNum = Number(limit);
      if (!isNaN(limitNum) && limitNum > 0) {
        params.limit = limitNum;
      }
    }
    if (sort && sort.trim() !== "") params.sort = sort.trim();
    if (page_token && page_token.trim() !== "") params.page_token = page_token.trim();
    if (include_content !== undefined && include_content !== "") {
      params.include_content = include_content === "true" || include_content === true;
    }

    // Make REST API call
    const response = await axios.get("https://data.alpaca.markets/v1beta1/news", {
      headers: {
        "APCA-API-KEY-ID": api_key,
        "APCA-API-SECRET-KEY": secret_key,
      },
      params,
    });

    res.json({
      success: true,
      data: {
        news: response.data.news || [],
        count: response.data.news?.length || 0,
        next_page_token: response.data.next_page_token || null,
      },
    });
  } catch (error) {
    console.error("Fetch news error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch news",
    });
  }
});

export default router;
