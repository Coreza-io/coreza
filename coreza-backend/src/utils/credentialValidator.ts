/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * Production-grade credential validation utilities
 * Broker validations are config-driven via BROKER_CAPABILITIES.
 * Non-broker services (gmail, whatsapp, telegram, etc.) remain here as static entries.
 */

import { BROKER_CAPABILITIES } from "../brokers/capabilities";

export interface CredentialValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Non-broker service validation configs (static)
interface ServiceValidationConfig {
  requiredFields: { key: string; label: string; minLength?: number; pattern?: RegExp }[];
  optionalWarnings?: { key: string; message: string }[];
}

const SERVICE_VALIDATIONS: Record<string, ServiceValidationConfig> = {
  gmail: {
    requiredFields: [
      { key: "client_id", label: "Gmail client ID" },
      { key: "client_secret", label: "Gmail client secret" },
    ],
    optionalWarnings: [
      { key: "refresh_token", message: "Gmail refresh token not provided - may need re-authentication" },
    ],
  },
  whatsapp: {
    requiredFields: [
      { key: "access_token", label: "WhatsApp access token" },
      { key: "phone_number_id", label: "WhatsApp phone number ID" },
    ],
  },
  finnhub: {
    requiredFields: [
      { key: "api_key", label: "FinnHub API key", minLength: 10 },
    ],
  },
  redis: {
    requiredFields: [
      { key: "host", label: "Redis host" },
    ],
  },
  telegram: {
    requiredFields: [
      { key: "bot_token", label: "Telegram bot token", pattern: /^\d+:[A-Za-z0-9_-]+$/ },
    ],
  },
};

export class CredentialValidator {
  /**
   * Validate credential structure for a given service type (config-driven)
   */
  static validateCredentials(
    serviceType: string,
    credentials: any
  ): CredentialValidationResult {
    const result: CredentialValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
    };

    if (!credentials || typeof credentials !== "object") {
      result.isValid = false;
      result.errors.push("Credentials must be a valid object");
      return result;
    }

    const normalizedType = serviceType.toLowerCase();

    // Check broker capabilities registry first
    const brokerCap = BROKER_CAPABILITIES[normalizedType];
    if (brokerCap?.credentialValidation) {
      return this.validateFromConfig(
        credentials,
        brokerCap.credentialValidation.requiredFields,
        brokerCap.displayName,
        result,
      );
    }

    // Check non-broker service validations
    const serviceConfig = SERVICE_VALIDATIONS[normalizedType] || SERVICE_VALIDATIONS[
      // Handle aliases
      normalizedType === "yahoo" || normalizedType === "yahoofinance" ? "yahoo" : normalizedType
    ];

    if (serviceConfig) {
      const validated = this.validateFromConfig(
        credentials,
        serviceConfig.requiredFields,
        serviceType,
        result,
      );

      // Add optional warnings
      if (serviceConfig.optionalWarnings) {
        for (const warn of serviceConfig.optionalWarnings) {
          if (!credentials[warn.key]) {
            validated.warnings.push(warn.message);
          }
        }
      }

      return validated;
    }

    // Yahoo Finance special case - no credentials typically required
    if (normalizedType === "yahoo" || normalizedType === "yahoofinance") {
      if (
        credentials.api_key &&
        (typeof credentials.api_key !== "string" || credentials.api_key.length < 5)
      ) {
        result.warnings.push("Yahoo Finance API key format may be invalid");
      }
      return result;
    }

    // Redis additional validations
    if (normalizedType === "redis") {
      return this.validateRedisCredentials(credentials, result);
    }

    result.warnings.push(`Unknown service type: ${serviceType}`);
    return result;
  }

  private static validateFromConfig(
    creds: any,
    fields: { key: string; label: string; minLength?: number; pattern?: RegExp }[],
    displayName: string,
    result: CredentialValidationResult,
  ): CredentialValidationResult {
    for (const field of fields) {
      if (!creds[field.key]) {
        result.isValid = false;
        result.errors.push(`${field.label} is required`);
      } else if (typeof creds[field.key] !== "string") {
        result.isValid = false;
        result.errors.push(`${field.label} must be a string`);
      } else {
        if (field.minLength && creds[field.key].length < field.minLength) {
          result.isValid = false;
          result.errors.push(`Invalid ${field.label} format`);
        }
        if (field.pattern && !field.pattern.test(creds[field.key])) {
          result.isValid = false;
          result.errors.push(`Invalid ${field.label} format (expected: ${field.pattern})`);
        }
      }
    }
    return result;
  }

  private static validateRedisCredentials(
    creds: any,
    result: CredentialValidationResult
  ): CredentialValidationResult {
    if (!creds.host || typeof creds.host !== "string") {
      result.isValid = false;
      result.errors.push("Redis host is required");
    }

    if (creds.port) {
      const port = parseInt(creds.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        result.isValid = false;
        result.errors.push("Redis port must be a valid number between 1 and 65535");
      }
    }

    if (creds.database) {
      const db = parseInt(creds.database, 10);
      if (isNaN(db) || db < 0 || db > 15) {
        result.isValid = false;
        result.errors.push("Redis database must be a number between 0 and 15");
      }
    }

    return result;
  }

  /**
   * Sanitize credentials for logging (remove sensitive data)
   */
  static sanitizeForLogging(credentials: any): any {
    if (!credentials || typeof credentials !== "object") {
      return credentials;
    }

    const sanitized = { ...credentials };
    const sensitiveFields = [
      "api_key",
      "secret_key",
      "access_token",
      "refresh_token",
      "client_secret",
      "password",
      "private_key",
      "bot_token",
    ];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        const value = sanitized[field];
        if (typeof value === "string" && value.length > 8) {
          sanitized[field] = `${value.substring(0, 4)}...${value.substring(
            value.length - 4
          )}`;
        } else {
          sanitized[field] = "[REDACTED]";
        }
      }
    });

    return sanitized;
  }
}
