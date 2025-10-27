import express from "express";
import { BrokerService } from "../services/brokers";

const router = express.Router();

// Get user credentials list for Alpaca
router.get("/credentials", async (req, res, next) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const credentials = await BrokerService.getCredentialsList(
      "alpaca",
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

// Add auth-url endpoint for authAction
router.post("/auth-url", async (req, res, next) => {
  try {
    const { user_id, credential_name, api_key, secret_key } = req.body;
    if (!user_id || !credential_name || !api_key || !secret_key) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const data = await BrokerService.saveCredentials(
      "alpaca",
      user_id,
      credential_name,
      {
        api_key,
        secret_key,
      }
    );

    res.json({
      success: true,
      message: "Alpaca credentials saved successfully",
      credential_id: data.id,
    });
  } catch (error) {
    next(error);
  }
});

// Dynamic operation endpoint to match node pattern
router.post("/:operation", async (req, res, next) => {
  try {
    const { operation } = req.params;
    const { user_id, credential_id } = req.body;
    if (!user_id || !credential_id) {
      return res
        .status(400)
        .json({ error: "user_id and credential_id are required" });
    }

    const result = await BrokerService.execute("alpaca", {
      user_id,
      credential_id,
      operation,
      ...req.body,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    console.error("Alpaca operation error:", error);
    next(error);
  }
});

export default router;
