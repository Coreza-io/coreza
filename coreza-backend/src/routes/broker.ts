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
import { isSupportedBroker } from "../brokers";
import CredentialManager from "../utils/credentialManager";
import { requireAuth } from "../middleware/jwtAuth";
import { BrokerExecutor } from "../nodes/executors/BrokerExecutor";
import { WorkflowNode } from "../nodes/types";

const router = express.Router();

function normalizeBroker(broker: string) {
  return broker?.toLowerCase();
}

router.use(requireAuth);

const brokerExecutor = new BrokerExecutor();

// Get user credentials list for any broker
router.get("/:broker/credentials", async (req, res, next) => {
  try {
    const { broker } = req.params;
    const brokerKey = normalizeBroker(broker);
    const userId = req.user?.id;

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const credentials = await CredentialManager.listCredentials(
      userId,
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
    const { credential_name, ...credentials } = req.body;
    const userId = req.user?.id;

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!userId || !credential_name) {
      return res.status(400).json({ error: "credential_name is required" });
    }

    const credentialId = await CredentialManager.saveCredentials(
      userId,
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
    const { credential_id } = req.body;
    const userId = req.user?.id;

    if (!brokerKey) {
      return res.status(400).json({ error: "broker is required" });
    }

    if (!isSupportedBroker(brokerKey)) {
      return res
        .status(400)
        .json({ error: `Unsupported broker: ${brokerKey}` });
    }

    if (!userId || !credential_id) {
      return res.status(400).json({ error: "credential_id is required" });
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

    const node: WorkflowNode = {
      id: `broker:${brokerKey}:${operation}`,
      name: brokerKey,
      node_type: "main",
      category: "Broker",
      subCategory: brokerKey,
      values: { ...req.body, operation },
    };

    const result = await brokerExecutor.execute(node, req.body, {
      userId,
      workflowId: "manual-broker-route",
      runId: `manual-${Date.now()}`,
    });

    if (result.success) {
      return res.json({ success: true, data: result.data, meta: result.meta });
    }

    res.status(400).json({ success: false, error: result.error });
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
