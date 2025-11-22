import express from "express";
import axios from "axios";
import CredentialManager from "../utils/credentialManager";
import { getBrokerService } from "../services/brokers";

const router = express.Router();

// Temporary storage for OAuth sessions (in-memory for MVP)
const tempAuthSessions = new Map<
  string,
  { app_key: string; app_secret: string; expires: number }
>();

// Clean up expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of tempAuthSessions.entries()) {
    if (now > session.expires) {
      tempAuthSessions.delete(id);
    }
  }
}, 10 * 60 * 1000);

// Step 1: Generate authorization URL
router.post("/generate-auth-url", async (req, res) => {
  try {
    const { app_key, app_secret } = req.body;

    if (!app_key || !app_secret) {
      return res.status(400).json({
        success: false,
        error: "app_key and app_secret are required",
      });
    }

    // Generate temp session ID
    const temp_id = `schwab_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Store credentials temporarily (10 minute expiry)
    tempAuthSessions.set(temp_id, {
      app_key,
      app_secret,
      expires: Date.now() + 10 * 60 * 1000,
    });

    // Generate Schwab authorization URL
    const auth_url = `https://api.schwabapi.com/v1/oauth/authorize?client_id=${app_key}&redirect_uri=https://127.0.0.1`;

    console.log(
      "🔐 [SCHWAB-AUTH] Generated auth URL for temp session:",
      temp_id
    );

    res.json({
      success: true,
      auth_url,
      temp_id,
    });
  } catch (error: any) {
    console.error("[SCHWAB-AUTH] Error generating auth URL:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate authorization URL",
    });
  }
});

// Step 2: Exchange authorization code for tokens
router.post("/exchange-token", async (req, res) => {
  try {
    const { temp_id, redirect_url, credential_name, user_id } = req.body;

    if (!temp_id || !redirect_url || !credential_name || !user_id) {
      return res.status(400).json({
        success: false,
        error:
          "temp_id, redirect_url, credential_name, and user_id are required",
      });
    }

    // Retrieve stored credentials
    const session = tempAuthSessions.get(temp_id);
    if (!session) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired session. Please try again.",
      });
    }

    // Check if session expired
    if (Date.now() > session.expires) {
      tempAuthSessions.delete(temp_id);
      return res.status(400).json({
        success: false,
        error: "Session expired. Please start the connection process again.",
      });
    }

    // Extract authorization code from redirect URL
    const codeMatch = redirect_url.match(/code=([^&]+)/);
    if (!codeMatch) {
      return res.status(400).json({
        success: false,
        error:
          "Could not extract authorization code from redirect URL. Please ensure you copied the full URL.",
      });
    }

    // Always URL-decode and trim the authorization code
    let code = decodeURIComponent(codeMatch[1]).trim();

    console.log("🔑 [SCHWAB-AUTH] Exchanging authorization code for tokens...");

    // Create Basic Auth header
    const credentials = `${session.app_key}:${session.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString("base64");

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      "https://api.schwabapi.com/v1/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: "https://127.0.0.1",
      }),
      {
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    console.log("✅ [SCHWAB-AUTH] Successfully obtained tokens");

    // Calculate token expiry timestamp
    const token_expires_at = Math.floor(Date.now() / 1000) + expires_in;

    // Save credentials using CredentialManager
    await CredentialManager.storeCredentials(
      user_id,
      "schwab",
      credential_name,
      {
        app_key: session.app_key,
        app_secret: session.app_secret,
        access_token,
        refresh_token,
        token_expires_at,
      },
      "api"
    );

    // Clean up temporary session
    tempAuthSessions.delete(temp_id);

    console.log("💾 [SCHWAB-AUTH] Credentials stored successfully");

    res.json({
      success: true,
    });
  } catch (error: any) {
    console.error("[SCHWAB-AUTH] Error exchanging token:", error);

    // Provide helpful error messages
    let errorMessage = "Failed to exchange authorization code for tokens";

    if (error.response?.data) {
      errorMessage = `Schwab API error: ${
        error.response.data.error_description ||
        error.response.data.error ||
        "Unknown error"
      }`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Step 3: Refresh access token
router.post("/refresh-token", async (req, res) => {
  try {
    const { user_id, credential_id } = req.body;

    if (!user_id || !credential_id) {
      return res.status(400).json({
        success: false,
        error: "user_id and credential_id are required",
      });
    }

    console.log("🔄 [SCHWAB-AUTH] Refreshing access token...");

    // Get stored credentials
    const result = await CredentialManager.getCredentials(
      user_id,
      "schwab",
      credential_id
    );

    if (!result.credentials) {
      return res.status(404).json({
        success: false,
        error: "Credentials not found",
      });
    }

    const creds = result.credentials.client_json;

    // Create Basic Auth header
    const credentials = `${creds.app_key}:${creds.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString("base64");

    // Refresh the token
    const tokenResponse = await axios.post(
      "https://api.schwabapi.com/v1/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
      }),
      {
        headers: {
          Authorization: `Basic ${encodedCredentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data;
    const token_expires_at = Math.floor(Date.now() / 1000) + expires_in;

    console.log("✅ [SCHWAB-AUTH] Token refreshed successfully");

    // Update stored credentials with new access token using CredentialManager
    await CredentialManager.storeCredentials(
      user_id,
      "schwab",
      credential_id,
      {
        app_key: creds.app_key,
        app_secret: creds.app_secret,
        access_token,
        refresh_token: creds.refresh_token, // Keep existing refresh token
        token_expires_at,
      },
      "api"
    );

    res.json({
      success: true,
      new_access_token: access_token,
      expires_at: token_expires_at,
    });
  } catch (error: any) {
    console.error("[SCHWAB-AUTH] Error refreshing token:", error);

    let errorMessage = "Failed to refresh access token";

    if (error.response?.data) {
      errorMessage = `Schwab API error: ${
        error.response.data.error_description ||
        error.response.data.error ||
        "Unknown error"
      }`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// ============================================
// Schwab Trading Routes
// ============================================

// List Schwab credentials
router.get("/credentials", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const credentials = await CredentialManager.listCredentials(
      userId,
      "schwab"
    );

    res.json({
      success: true,
      credentials: credentials.map((c: any) => ({
        id: c.name,
        name: c.name,
        account_number: c.client_json?.account_number,
      })),
    });
  } catch (error: any) {
    console.error("[SCHWAB] Error listing credentials:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to list credentials",
    });
  }
});

// Get account numbers (encrypted hashes)
router.post("/get_account_numbers", async (req, res, next) => {
  try {
    console.log(`📥 [SCHWAB] get_account_numbers request received:`, {
      body: req.body,
      headers: {
        'content-type': req.headers['content-type'],
        'authorization': req.headers.authorization ? 'Bearer [PRESENT]' : '[MISSING]'
      }
    });
    
    const { user_id, credential_id } = req.body;

    if (!user_id || !credential_id) {
      console.error(`❌ [SCHWAB] Missing required fields:`, {
        user_id: user_id || '[MISSING]',
        credential_id: credential_id || '[MISSING]'
      });
      return res.status(400).json({
        success: false,
        error: "user_id and credential_id are required",
      });
    }

    console.log(`✅ [SCHWAB] Calling broker service with:`, { user_id, credential_id });

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      console.error(`❌ [SCHWAB] Broker service not available`);
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      user_id,
      credential_id,
      operation: "get_account_numbers",
    });

    console.log(`📤 [SCHWAB] Broker service result:`, {
      success: result?.success,
      hasData: !!result?.data,
      error: result?.error || 'none'
    });

    if (!result || !result.success) {
      return res.status(400).json({
        success: false,
        error: result?.error || "Failed to fetch accounts",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error("❌ [SCHWAB] get_account_numbers error:", error);
    next(error);
  }
});

// Dynamic operation endpoint for all broker operations
router.post("/:operation", async (req, res) => {
  try {
    const { operation } = req.params;
    const { user_id, credential_id } = req.body;

    if (!user_id || !credential_id) {
      return res.status(400).json({
        success: false,
        error: "User ID and credential_id are required",
      });
    }

    // All supported operations go through broker service
    const supportedOps = [
      "get_account_numbers",
      "get_account",
      "get_positions",
      "get_orders",
      "get_quotes",
      "get_price_history",
      "place_order",
      "cancel_order",
    ];

    if (!supportedOps.includes(operation)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported operation: ${operation}`,
      });
    }

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      user_id: user_id,
      credential_id,
      operation,
      ...req.body,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Operation failed",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error(`[SCHWAB] ${req.params.operation} error:`, error);
    res.status(500).json({
      success: false,
      error: error.message || "Operation failed",
    });
  }
});

// Place order through broker service
router.post("/place_order", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const input = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
      });
    }

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      ...input,
      operation: "place_order",
      user_id: userId,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to place order",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error("[SCHWAB] Error placing order:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to place order",
    });
  }
});

// Get account info
router.get("/get_account", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const credentialId = req.query.credential_id as string;

    if (!userId || !credentialId) {
      return res.status(400).json({
        success: false,
        error: "User ID and credential_id are required",
      });
    }

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      operation: "get_account",
      user_id: userId,
      credential_id: credentialId,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to get account",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error("[SCHWAB] Error getting account:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get account",
    });
  }
});

// Get positions
router.get("/get_positions", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const credentialId = req.query.credential_id as string;

    if (!userId || !credentialId) {
      return res.status(400).json({
        success: false,
        error: "User ID and credential_id are required",
      });
    }

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      operation: "get_positions",
      user_id: userId,
      credential_id: credentialId,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to get positions",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error("[SCHWAB] Error getting positions:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get positions",
    });
  }
});

// Get orders
router.get("/get_orders", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] as string;
    const credentialId = req.query.credential_id as string;

    if (!userId || !credentialId) {
      return res.status(400).json({
        success: false,
        error: "User ID and credential_id are required",
      });
    }

    const brokerService = getBrokerService("schwab");
    if (!brokerService) {
      return res.status(500).json({
        success: false,
        error: "Schwab broker service not available",
      });
    }

    const result = await brokerService.execute({
      operation: "get_orders",
      user_id: userId,
      credential_id: credentialId,
      ...req.query,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error || "Failed to get orders",
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error("[SCHWAB] Error getting orders:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get orders",
    });
  }
});

export default router;
