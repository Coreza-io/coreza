/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import axios from "axios";
import { google } from "googleapis";
import {
  OAuthTokenLifecycleConfig,
  unixNowSeconds,
} from "../utils/oauthTokenLifecycle";

export interface OAuthSessionData {
  provider: string;
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scope?: string[];
  state?: string;
  callbackSession?: string;
}

export interface OAuthTokenResult {
  client?: Record<string, any>;
  token: Record<string, any>;
  meta?: Record<string, any>;
  scopes?: string[];
}

export interface OAuthProviderConfig {
  clientIdField: string;
  clientSecretField: string;
  redirectUriField?: string;
  defaultRedirectUri?: string;
  defaultScopes?: string[];
  generateAuthUrl: (
    session: OAuthSessionData,
    body: any,
  ) => Promise<string> | string;
  exchangeCode: (params: {
    code?: string;
    session: OAuthSessionData;
  }) => Promise<OAuthTokenResult>;
  refreshToken?: (params: { credentials: any }) => Promise<OAuthTokenResult>;
  tokenLifecycle?: OAuthTokenLifecycleConfig;
}

const SCHWAB_REDIRECT_URI = "https://127.0.0.1";
const SCHWAB_REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export const OAUTH_CONFIGS: Record<string, OAuthProviderConfig> = {
  schwab: {
    clientIdField: "app_key",
    clientSecretField: "app_secret",
    defaultRedirectUri: SCHWAB_REDIRECT_URI,
    tokenLifecycle: {
      refreshTokenLifetimeSeconds: SCHWAB_REFRESH_TOKEN_LIFETIME_SECONDS,
    },
    generateAuthUrl: async (session) =>
      `https://api.schwabapi.com/v1/oauth/authorize?client_id=${encodeURIComponent(
        session.clientId,
      )}&redirect_uri=${encodeURIComponent(
        session.redirectUri || SCHWAB_REDIRECT_URI,
      )}`,
    exchangeCode: async ({ code, session }) => {
      const authCode = decodeURIComponent(code || "").trim();

      if (!authCode) {
        throw new Error(
          "Authorization code is required. Please provide code or redirect_url containing the code.",
        );
      }

      const credentials = `${session.clientId}:${session.clientSecret}`;
      const encodedCredentials = Buffer.from(credentials).toString("base64");

      const tokenResponse = await axios.post(
        "https://api.schwabapi.com/v1/oauth/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code: authCode,
          redirect_uri: session.redirectUri || SCHWAB_REDIRECT_URI,
        }),
        {
          headers: {
            Authorization: `Basic ${encodedCredentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      const now = unixNowSeconds();
      const token_expires_at = now + expires_in;

      return {
        client: {
          app_key: session.clientId,
          app_secret: session.clientSecret,
        },
        token: {
          access_token,
          refresh_token,
          token_expires_at,
          refresh_token_created_at: now,
          refresh_token_expires_at: now + SCHWAB_REFRESH_TOKEN_LIFETIME_SECONDS,
        },
      };
    },
    refreshToken: async ({ credentials }) => {
      const encodedCredentials = Buffer.from(
        `${credentials.app_key}:${credentials.app_secret}`,
      ).toString("base64");

      const tokenResponse = await axios.post(
        "https://api.schwabapi.com/v1/oauth/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refresh_token,
        }),
        {
          headers: {
            Authorization: `Basic ${encodedCredentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      const { access_token, expires_in } = tokenResponse.data;
      const now = unixNowSeconds();
      const token_expires_at = now + expires_in;

      return {
        client: {
          app_key: credentials.app_key,
          app_secret: credentials.app_secret,
        },
        token: {
          access_token,
          refresh_token: credentials.refresh_token,
          token_expires_at,
          refresh_token_created_at: credentials.refresh_token_created_at,
          refresh_token_expires_at: credentials.refresh_token_expires_at,
          last_refreshed_at: now,
        },
      };
    },
  },
  gmail: {
    clientIdField: "client_id",
    clientSecretField: "client_secret",
    redirectUriField: "redirect_uri",
    defaultScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    generateAuthUrl: async (session, body) => {
      const oauth2Client = new google.auth.OAuth2(
        session.clientId,
        session.clientSecret,
        session.redirectUri,
      );

      const scopes = session.scope;

      return oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes?.length ? scopes : undefined,
        redirect_uri: session.redirectUri,
      });
    },
    exchangeCode: async ({ code, session }) => {
      if (!code) {
        throw new Error("Authorization code is required for Gmail OAuth");
      }

      const oauth2Client = new google.auth.OAuth2(
        session.clientId,
        session.clientSecret,
        session.redirectUri,
      );

      try {
        const { tokens } = await oauth2Client.getToken(code.trim());

        const token_expires_at = tokens.expiry_date
          ? Math.floor(tokens.expiry_date / 1000)
          : undefined;

        return {
          client: {
            client_id: session.clientId,
            client_secret: session.clientSecret,
            redirect_uri: session.redirectUri,
          },
          token: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at,
          },
          scopes: tokens.scope ? tokens.scope.split(" ") : session.scope,
        };
      } catch (error: any) {
        if (error.message?.includes("invalid_grant")) {
          throw new Error(
            "Invalid authorization code. The code may have expired (valid for 5-10 minutes), " +
              "already been used, or the redirect URI may not match what is configured in Google Cloud Console. " +
              "Please restart the authorization process.",
          );
        }
        throw error;
      }
    },
    refreshToken: async ({ credentials }) => {
      const oauth2Client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uri,
      );

      oauth2Client.setCredentials({ refresh_token: credentials.refresh_token });
      const { credentials: refreshed } =
        await oauth2Client.refreshAccessToken();

      const token_expires_at = refreshed.expiry_date
        ? Math.floor(refreshed.expiry_date / 1000)
        : undefined;

      return {
        client: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          redirect_uri: credentials.redirect_uri,
        },
        token: {
          access_token: refreshed.access_token,
          refresh_token: credentials.refresh_token,
          token_expires_at,
        },
        scopes: refreshed.scope ? refreshed.scope.split(" ") : undefined,
      };
    },
  },
};
