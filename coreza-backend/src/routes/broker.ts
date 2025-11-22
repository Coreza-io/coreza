import express from "express";
import axios from "axios";
import CredentialManager from "../utils/credentialManager";
import { BrokerService } from "../services/brokers";

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

function normalizeBroker(broker: string) {
  return broker?.toLowerCase();
}

// Get user credentials list for any broker
router.get("/:broker/credentials", async (req, res, next) => {
  try {
    const { broker } = req.params;
    const { user_id } = req.query;
    const brokerKey = normalizeBroker(broker);

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    if (brokerKey === "schwab") {
      const credentials = await CredentialManager.listCredentials(
        user_id as string,
        "schwab"
      );

      return res.json({
        success: true,
        credentials: credentials.map((c: any) => ({
          id: c.name,
          name: c.name,
          account_number: c.client_json?.account_number,
        })),
      });
    }

    const credentials = await BrokerService.getCredentialsList(
      brokerKey,
      user_id as string
    );

    res.json({
      success: true,
      credentials,
    });
  } catch (error) {
    next(error);
  }
});

// Generic credential storage for brokers that accept direct keys/secrets
router.post("/:broker/auth", async (req, res, next) => {
  try {
    const { broker } = req.params;
    const brokerKey = normalizeBroker(broker);
    const { user_id, credential_name, ...credentials } = req.body;

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!user_id || !credential_name) {
      return res
        .status(400)
        .json({ error: "user_id and credential_name are required" });
    }

    const data = await BrokerService.saveCredentials(
      brokerKey,
      user_id,
      credential_name,
      credentials
    );

    if (!data.success) {
      return res.status(400).json({ error: data.error });
    }

    res.json({
      success: true,
      message: `${brokerKey} credentials saved successfully`,
      credential_id: data.id || data.credential_id,
    });
  } catch (error) {
    next(error);
  }
});

// Schwab OAuth: Step 1 - Generate authorization URL
router.post("/:broker/generate-auth-url", async (req, res) => {
  try {
    const broker = normalizeBroker(req.params.broker);
    const { app_key, app_secret } = req.body;

    if (broker !== "schwab") {
      return res.status(400).json({
        success: false,
        error: "generate-auth-url is only supported for Schwab",
      });
    }

    if (!app_key || !app_secret) {
      return res.status(400).json({
        success: false,
        error: "app_key and app_secret are required",
      });
    }

    const temp_id = `schwab_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    tempAuthSessions.set(temp_id, {
      app_key,
      app_secret,
      expires: Date.now() + 10 * 60 * 1000,
    });

    const auth_url = `https://api.schwabapi.com/v1/oauth/authorize?client_id=${app_key}&redirect_uri=https://127.0.0.1`;

    res.json({
      success: true,
      auth_url,
      temp_id,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate authorization URL",
    });
  }
});

// Schwab OAuth: Step 2 - Exchange authorization code for tokens
router.post("/:broker/exchange-token", async (req, res) => {
  try {
    const broker = normalizeBroker(req.params.broker);
    const { temp_id, redirect_url, credential_name, user_id } = req.body;

    if (broker !== "schwab") {
      return res.status(400).json({
        success: false,
        error: "exchange-token is only supported for Schwab",
      });
    }

    if (!temp_id || !redirect_url || !credential_name || !user_id) {
      return res.status(400).json({
        success: false,
        error: "temp_id, redirect_url, credential_name, and user_id are required",
      });
    }

    const session = tempAuthSessions.get(temp_id);
    if (!session) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired session. Please try again.",
      });
    }

    if (Date.now() > session.expires) {
      tempAuthSessions.delete(temp_id);
      return res.status(400).json({
        success: false,
        error: "Session expired. Please start the connection process again.",
      });
    }

    const codeMatch = redirect_url.match(/code=([^&]+)/);
    if (!codeMatch) {
      return res.status(400).json({
        success: false,
        error:
          "Could not extract authorization code from redirect URL. Please ensure you copied the full URL.",
      });
    }

    const code = decodeURIComponent(codeMatch[1]).trim();
    const credentials = `${session.app_key}:${session.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString("base64");

    const tokenResponse = await axios.post(
      "https://api.schwabapi.com/v1/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
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
    const token_expires_at = Math.floor(Date.now() / 1000) + expires_in;

    const credentialId = await CredentialManager.saveCredentials(
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

    tempAuthSessions.delete(temp_id);

    res.json({
      success: true,
      credential_id: credentialId,
    });
  } catch (error: any) {
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

// Schwab OAuth: Step 3 - Refresh access token
router.post("/:broker/refresh-token", async (req, res) => {
  try {
    const broker = normalizeBroker(req.params.broker);
    const { user_id, credential_id } = req.body;

    if (broker !== "schwab") {
      return res.status(400).json({
        success: false,
        error: "refresh-token is only supported for Schwab",
      });
    }

    if (!user_id || !credential_id) {
      return res.status(400).json({
        success: false,
        error: "user_id and credential_id are required",
      });
    }

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
    const credentials = `${creds.app_key}:${creds.app_secret}`;
    const encodedCredentials = Buffer.from(credentials).toString("base64");

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

    await CredentialManager.storeCredentials(
      user_id,
      "schwab",
      credential_id,
      {
        app_key: creds.app_key,
        app_secret: creds.app_secret,
        access_token,
        refresh_token: creds.refresh_token,
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

// Dynamic broker operation endpoint
router.post("/:broker/:operation", async (req, res, next) => {
  try {
    const { broker, operation } = req.params;
    const brokerKey = normalizeBroker(broker);
    const { user_id, credential_id } = req.body;

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
    }

    const result = await BrokerService.execute(brokerKey, {
      user_id,
      credential_id,
      operation,
      ...req.body,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data ?? result);
  } catch (error) {
    next(error);
  }
});

export default router;
