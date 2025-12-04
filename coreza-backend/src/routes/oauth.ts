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
import OAuthService from "../services/oauthService";

const router = express.Router();

router.post("/:provider/generate-auth-url", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { authUrl, tempId } = await OAuthService.generateAuthUrl(
      provider,
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
    const { credentialId } = await OAuthService.exchangeCode(provider, req.body);

    res.json({ success: true, credential_id: credentialId });
  } catch (error) {
    next(error);
  }
});

router.post("/:provider/refresh-token", async (req, res, next) => {
  try {
    const { provider } = req.params;
    const { tokens } = await OAuthService.refreshToken(provider, req.body);

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

