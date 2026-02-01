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

import * as jose from "jose";
import { createLogger } from "./logger";

const logger = createLogger("webhook-auth");

export interface WebhookAuthConfig {
  authentication?: string;
  authUsername?: string;
  authPassword?: string;
  authHeaderName?: string;
  authHeaderValue?: string;
  authJwtSecret?: string;
}

export interface WebhookAuthResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates incoming webhook requests based on the configured authentication mode.
 * Supports: none, basicAuth, headerAuth, jwtAuth
 */
export async function validateWebhookAuth(
  authConfig: WebhookAuthConfig,
  headers: Record<string, string | string[] | undefined>
): Promise<WebhookAuthResult> {
  const authMode = authConfig.authentication || "none";

  // Normalize headers to lowercase keys with string values
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      normalizedHeaders[key.toLowerCase()] = Array.isArray(value)
        ? value[0]
        : value;
    }
  }

  switch (authMode) {
    case "none":
      return { valid: true };

    case "basicAuth": {
      const authHeader = normalizedHeaders["authorization"];
      if (!authHeader?.startsWith("Basic ")) {
        logger.warn("Missing or invalid Basic Auth header");
        return { valid: false, error: "Missing Basic Auth header" };
      }

      try {
        const encoded = authHeader.slice(6);
        const decoded = Buffer.from(encoded, "base64").toString("utf-8");
        const colonIndex = decoded.indexOf(":");
        if (colonIndex === -1) {
          return { valid: false, error: "Invalid Basic Auth format" };
        }

        const username = decoded.slice(0, colonIndex);
        const password = decoded.slice(colonIndex + 1);

        if (
          username === authConfig.authUsername &&
          password === authConfig.authPassword
        ) {
          return { valid: true };
        }

        logger.warn("Invalid Basic Auth credentials");
        return { valid: false, error: "Invalid credentials" };
      } catch (e) {
        logger.error({ err: e }, "Error decoding Basic Auth header");
        return { valid: false, error: "Invalid Basic Auth encoding" };
      }
    }

    case "headerAuth": {
      if (!authConfig.authHeaderName) {
        return { valid: false, error: "Header name not configured" };
      }

      const headerName = authConfig.authHeaderName.toLowerCase();
      const headerValue = normalizedHeaders[headerName];

      if (headerValue === authConfig.authHeaderValue) {
        return { valid: true };
      }

      logger.warn({ headerName }, "Invalid header authentication");
      return { valid: false, error: "Invalid header authentication" };
    }

    case "jwtAuth": {
      const authHeader = normalizedHeaders["authorization"];
      if (!authHeader?.startsWith("Bearer ")) {
        logger.warn("Missing or invalid Bearer token");
        return { valid: false, error: "Missing Bearer token" };
      }

      if (!authConfig.authJwtSecret) {
        return { valid: false, error: "JWT secret not configured" };
      }

      try {
        const token = authHeader.slice(7);
        const secret = new TextEncoder().encode(authConfig.authJwtSecret);

        await jose.jwtVerify(token, secret);
        return { valid: true };
      } catch (e) {
        logger.warn({ err: e }, "JWT verification failed");
        return { valid: false, error: "Invalid JWT token" };
      }
    }

    default:
      logger.warn({ authMode }, "Unknown authentication mode, allowing request");
      return { valid: true };
  }
}
