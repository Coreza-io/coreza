/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import CredentialManager from "../utils/credentialManager";
import {
  OAUTH_CONFIGS,
  OAuthProviderConfig,
  OAuthSessionData,
  OAuthTokenResult,
} from "../config/oauth";

interface TempSession extends OAuthSessionData {
  expires: number;
}

interface OAuthCodeResolution {
  code: string;
  callbackSession?: string;
}

class OAuthService {
  private static tempSessions = new Map<string, TempSession>();

  static {
    setInterval(() => this.cleanupExpiredSessions(), 10 * 60 * 1000);
  }

  private static cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.tempSessions.entries()) {
      if (now > session.expires) {
        this.tempSessions.delete(id);
      }
    }
  }

  private static normalizeProvider(provider: string) {
    return provider?.toLowerCase();
  }

  private static resolveAuthorizationCode(
    body: Record<string, unknown>,
  ): OAuthCodeResolution {
    const directCode = typeof body.code === "string" ? body.code.trim() : "";
    let codeFromRedirect = "";
    let callbackSession: string | undefined;

    if (typeof body.redirect_url === "string" && body.redirect_url.trim()) {
      try {
        const redirectUrl = new URL(body.redirect_url.trim());
        codeFromRedirect = redirectUrl.searchParams.get("code")?.trim() || "";
        callbackSession =
          redirectUrl.searchParams.get("session")?.trim() || undefined;
      } catch {
        // Ignore malformed callback URLs so callers get the same clear missing-code error.
      }
    }

    const code = directCode || codeFromRedirect;

    if (!code) {
      throw new Error(
        "Authorization code is required. Please provide code or redirect_url containing the code.",
      );
    }

    return { code, callbackSession };
  }

  static getProviderConfig(provider: string): OAuthProviderConfig {
    const normalized = this.normalizeProvider(provider);
    const config = normalized ? OAUTH_CONFIGS[normalized] : undefined;

    if (!config) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    return config;
  }

  private static buildSession(
    provider: string,
    config: OAuthProviderConfig,
    body: any,
  ): TempSession {
    const clientId = body[config.clientIdField];
    const clientSecret = body[config.clientSecretField];
    const redirectField = config.redirectUriField || "redirect_uri";
    const redirectUri = body[redirectField] || config.defaultRedirectUri;
    const scope = body.scope || config.defaultScopes;

    if (!clientId || !clientSecret) {
      throw new Error(
        `${config.clientIdField} and ${config.clientSecretField} are required`,
      );
    }

    return {
      provider: this.normalizeProvider(provider),
      clientId,
      clientSecret,
      redirectUri,
      scope,
      state: body.state,
      expires: Date.now() + 10 * 60 * 1000,
    };
  }

  static getTokenLifecycleConfig(provider: string) {
    return this.getProviderConfig(provider).tokenLifecycle;
  }

  static async generateAuthUrl(provider: string, userId: string, body: any) {
    const config = this.getProviderConfig(provider);
    const session = this.buildSession(provider, config, body);
    const tempId = `${session.provider}_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}`;

    this.tempSessions.set(tempId, session);

    const authUrl = await config.generateAuthUrl(session, body);

    return { authUrl, tempId };
  }

  static async exchangeCode(provider: string, userId: string, body: any) {
    const config = this.getProviderConfig(provider);
    const { temp_id, credential_name } = body;
    const user_id = userId;

    if (!temp_id || !user_id || !credential_name) {
      throw new Error("temp_id, user_id, and credential_name are required");
    }

    const session = this.tempSessions.get(temp_id);

    if (!session) {
      throw new Error("Invalid or expired session. Please start again.");
    }

    if (Date.now() > session.expires) {
      this.tempSessions.delete(temp_id);
      throw new Error(
        "Session expired. Please start the connection process again.",
      );
    }

    const { code, callbackSession } = this.resolveAuthorizationCode(body);
    const exchangeSession = callbackSession
      ? { ...session, callbackSession }
      : session;

    const tokenData: OAuthTokenResult = await config.exchangeCode({
      code,
      session: exchangeSession,
    });

    const payload = {
      ...(tokenData.client || {}),
      ...(tokenData.token || {}),
    };

    const credentialId = await CredentialManager.saveCredentials(
      user_id,
      this.normalizeProvider(provider),
      credential_name,
      payload,
      tokenData.scopes?.join(" "),
    );

    this.tempSessions.delete(temp_id);

    return {
      credentialId,
      tokens: tokenData.token,
    };
  }

  static async refreshToken(
    provider: string,
    userId: string,
    credentialid: any,
  ) {
    const config = this.getProviderConfig(provider);

    if (!config.refreshToken) {
      throw new Error(`Refresh not supported for provider: ${provider}`);
    }

    const credential_id = credentialid;
    const user_id = userId;

    if (!user_id || !credential_id) {
      throw new Error("user_id and credential_id are required");
    }

    const result = await CredentialManager.getCredentials(
      user_id,
      this.normalizeProvider(provider),
      credential_id,
    );

    if (!result.credentials) {
      throw new Error("Credentials not found");
    }

    const credentials = {
      ...result.credentials.client_json,
      ...result.credentials.token_json,
    };

    const refreshed = await config.refreshToken({ credentials });
    const payload = {
      ...(refreshed.client || credentials),
      ...(refreshed.token || {}),
      ...(refreshed.meta || {}),
    };

    await CredentialManager.storeCredentials(
      user_id,
      this.normalizeProvider(provider),
      credential_id,
      payload,
      refreshed.scopes?.join(" "),
    );

    return {
      tokens: refreshed.token,
    };
  }
}

export default OAuthService;
