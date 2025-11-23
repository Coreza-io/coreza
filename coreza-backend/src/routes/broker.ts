import express from "express";
import axios, { AxiosRequestConfig } from "axios";
import CredentialManager from "../utils/credentialManager";
import { getBrokerConfig, isSupportedBroker } from "../config/brokers";

const router = express.Router();

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

    const credentials = await CredentialManager.listCredentials(
      user_id as string,
      brokerKey
    );

    const formattedCredentials =
      brokerKey === "schwab"
        ? credentials.map((c: any) => ({
            id: c.name,
            name: c.name,
            account_number: c.client_json?.account_number,
          }))
        : credentials.map((c: any) => ({
            id: c.name,
            name: c.name,
          }));

    res.json({
      success: true,
      credentials: formattedCredentials,
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

    const credentialId = await CredentialManager.saveCredentials(
      user_id,
      brokerKey,
      credential_name,
      credentials,
      "api"
    );

    res.json({
      success: true,
      message: `${brokerKey} credentials saved successfully`,
      credential_id: credentialId,
    });
  } catch (error) {
    next(error);
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

    if (!isSupportedBroker(brokerKey)) {
      return res
        .status(400)
        .json({ error: `Unsupported broker: ${brokerKey}` });
    }

    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
    }

    const config = getBrokerConfig(brokerKey);
    if (!config) {
      return res
        .status(400)
        .json({ error: `Broker config not found: ${brokerKey}` });
    }

    const op = config.operations[operation];
    if (!op) {
      return res
        .status(400)
        .json({
          error: `Unsupported operation: ${operation} for broker: ${brokerKey}`,
        });
    }

    // Parse symbol if it's a JSON array string
    if (typeof req.body.symbol === "string") {
      try {
        const parsed = JSON.parse(req.body.symbol);
        if (Array.isArray(parsed)) {
          req.body.symbol = parsed.join(",");
        }
      } catch {
        // not JSON, leave as-is
      }
    }

    // 1. Get credentials
    const { credentials } = await CredentialManager.getCredentials(
      user_id,
      brokerKey,
      credential_id
    );
    const creds = credentials?.client_json;

    // 2. Build request
    const baseUrl =
      typeof config.baseUrl === "function"
        ? config.baseUrl(creds, { operation, ...req.body })
        : config.baseUrl;

    const path =
      typeof op.path === "function" ? op.path(req.body, creds) : op.path;
    const url = `${baseUrl}${path}`;
    const headers = await config.makeAuthHeaders(creds);
    const params = op.makeParams?.(req.body) ?? {};
    const body = op.makeBody ? await op.makeBody(req.body, creds) : undefined;

    // 3. Execute request
    const axiosConfig: AxiosRequestConfig = {
      method: op.method,
      url,
      headers,
      params,
      timeout: 30_000,
    };

    if (["post", "put", "patch", "delete"].includes(op.method.toLowerCase())) {
      axiosConfig.data = body;
    }

    const response = await axios.request(axiosConfig);

    // 4. Transform result
    const rawData = response.data;
    const data = op.transformResult
      ? op.transformResult(rawData, req.body)
      : rawData;

    res.json({ success: true, data });
  } catch (err: any) {
    const status = err.response?.status;
    let message =
      err.response?.data?.errorMessage ||
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      "Unknown error";

    if (status === 503) {
      message =
        "API service is temporarily unavailable (HTTP 503). Please try again later.";
    } else if (status === 400) {
      if (err.response?.data?.errorMessage || err.response?.data?.errorCode) {
        message = `API Error [${err.response.data.errorCode || "400"}]: ${
          err.response.data.errorMessage || message
        }`;
      }
    } else if (!message && err.response?.statusText) {
      message = err.response.statusText;
    }

    res.status(status || 500).json({ success: false, error: message });
  }
});

export default router;
