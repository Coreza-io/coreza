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

