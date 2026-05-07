/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import express from "express";
import OAuthService from "../services/oauthService";
import { requireAuth } from "../middleware/jwtAuth";

const router = express.Router();

router.use(requireAuth);

router.post("/:provider/generate-auth-url", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { authUrl, tempId } = await OAuthService.generateAuthUrl(
      provider,
      user_id,
      req.body
    );

    res.json({ success: true, auth_url: authUrl, temp_id: tempId });
  } catch (error) {
    next(error);
  }
});

router.post("/:provider/exchange-token", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { credentialId } = await OAuthService.exchangeCode(
      provider,
      user_id,
      req.body
    );

    res.json({ success: true, credential_id: credentialId });
  } catch (error) {
    next(error);
  }
});

router.post("/:provider/refresh-token", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { tokens } = await OAuthService.refreshToken(
      provider,
      user_id,
      req.body
    );

    res.json({
      success: true,
      new_access_token: tokens?.access_token,
      expires_at: tokens?.token_expires_at,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
