import express from "express";
import OAuthService from "../services/oauthService";
import { OAUTH_CONFIGS } from "../config/oauth";

const router = express.Router();

router.get("/providers", async (req, res, next) => {
  try {
    const { provider } = req.query;

    // If specific provider requested, return only that one
    if (provider && typeof provider === "string") {
      const config = OAUTH_CONFIGS[provider];
      if (!config) {
        return res.status(404).json({ 
          success: false, 
          error: `Provider '${provider}' not found` 
        });
      }

      const providerData = {
        id: provider,
        name: config.displayName,
        authFlowType: config.authFlowType,
        docsUrl: config.docsUrl,
        authUrlDisplayName: config.authUrlDisplayName,
        callbackPlaceholder: config.callbackPlaceholder,
        callbackHelpText: config.callbackHelpText,
        fields: [
          {
            key: "credential_name",
            label: "Credential Name",
            type: "text",
            placeholder: `My ${config.displayName} Account`,
            required: true,
          },
          {
            key: config.clientIdField,
            label: config.clientIdField
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "),
            type: "password",
            placeholder: `Enter your ${config.displayName} ${config.clientIdField.replace(/_/g, " ")}`,
            required: true,
          },
          {
            key: config.clientSecretField,
            label: config.clientSecretField
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" "),
            type: "password",
            placeholder: `Enter your ${config.displayName} ${config.clientSecretField.replace(/_/g, " ")}`,
            required: true,
          },
          ...(config.redirectUriField
            ? [
                {
                  key: config.redirectUriField,
                  label: "Redirect URI",
                  type: "text",
                  placeholder:
                    config.defaultRedirectUri ||
                    "http://localhost:8000/callback",
                  required: false,
                },
              ]
            : []),
        ],
      };

      return res.json({ success: true, provider: providerData });
    }

    // Return all providers if no specific provider requested
    const providers = Object.entries(OAUTH_CONFIGS).map(([id, config]) => ({
      id,
      name: config.displayName,
      authFlowType: config.authFlowType,
      docsUrl: config.docsUrl,
      authUrlDisplayName: config.authUrlDisplayName,
      callbackPlaceholder: config.callbackPlaceholder,
      callbackHelpText: config.callbackHelpText,
      fields: [
        {
          key: "credential_name",
          label: "Credential Name",
          type: "text",
          placeholder: `My ${config.displayName} Account`,
          required: true,
        },
        {
          key: config.clientIdField,
          label: config.clientIdField
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          type: "password",
          placeholder: `Enter your ${config.displayName} ${config.clientIdField.replace(/_/g, " ")}`,
          required: true,
        },
        {
          key: config.clientSecretField,
          label: config.clientSecretField
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
          type: "password",
          placeholder: `Enter your ${config.displayName} ${config.clientSecretField.replace(/_/g, " ")}`,
          required: true,
        },
        ...(config.redirectUriField
          ? [
              {
                key: config.redirectUriField,
                label: "Redirect URI",
                type: "text",
                placeholder:
                  config.defaultRedirectUri ||
                  "http://localhost:8000/callback",
                required: false,
              },
            ]
          : []),
      ],
    }));

    res.json({ success: true, providers });
  } catch (error) {
    next(error);
  }
});

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

