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

import axios, { AxiosRequestConfig } from "axios";
import {
  CommunicationConfig,
  CommunicationInput,
  CommunicationResult,
  ICommunicationService,
} from "./types";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";

export class CommunicationService implements ICommunicationService {
  constructor(
    public readonly serviceKey: string,
    public readonly config: CommunicationConfig
  ) {}

  private normalizeIds(input: CommunicationInput): {
    userId?: string;
    credentialId?: string;
  } {
    return {
      userId: input.user_id ?? input.userId,
      credentialId: input.credential_id ?? input.credentialId,
    };
  }

  async execute(input: CommunicationInput): Promise<CommunicationResult> {
    try {
      const { userId, credentialId } = this.normalizeIds(input);
      const operation = input.operation;

      if (!operation) {
        return { success: false, error: "operation is required" };
      }

      if (!userId || !credentialId) {
        return { success: false, error: "user_id and credential_id are required" };
      }

      // Get credentials
      const result = await CredentialManager.getCredentials(
        userId,
        this.serviceKey,
        credentialId
      );

      if (!result.credentials) {
        return { success: false, error: `${this.serviceKey} credentials not found` };
      }

      // Resolve credentials (handle OAuth refresh if needed)
      const creds = await this.resolveCredentials(result.credentials, input);

      // Check for custom execute handler (for complex services like Gmail)
      if (this.config.customExecute) {
        const data = await this.config.customExecute(operation, input, creds);
        return { success: true, data };
      }

      // Standard config-driven execution
      const op = this.config.operations[operation];
      if (!op) {
        return {
          success: false,
          error: `Unsupported operation: ${operation} for ${this.serviceKey}`,
        };
      }

      // Validate input if validator defined
      if (op.validateInput) {
        const validation = op.validateInput(input);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      // Build request
      const baseUrl =
        typeof this.config.baseUrl === "function"
          ? this.config.baseUrl(creds, input)
          : this.config.baseUrl;

      const path = typeof op.path === "function" ? op.path(input, creds) : op.path;
      const url = `${baseUrl}${path}`;

      const headers = await this.config.makeAuthHeaders(creds);
      const params = op.makeParams?.(input, creds) ?? {};
      const body = op.makeBody?.(input, creds);

      const axiosConfig: AxiosRequestConfig = {
        method: op.method,
        url,
        headers,
        params,
        timeout: 30_000,
      };

      if (["post", "put", "patch", "delete"].includes(op.method) && body) {
        axiosConfig.data = body;
      }

      console.log(`📨 [CommunicationService] ${this.serviceKey}.${operation}:`, {
        url,
        method: op.method,
      });

      const response = await axios.request(axiosConfig);
      const data = op.transformResult
        ? op.transformResult(response.data, input)
        : response.data;

      return { success: true, data };
    } catch (error: any) {
      console.error(
        `[CommunicationService] ${this.serviceKey} error:`,
        error.message || error
      );

      // Handle authentication errors
      if (error.response?.status === 401) {
        return {
          success: false,
          error: `${this.serviceKey} authentication expired. Please re-authorize.`,
        };
      }

      return {
        success: false,
        error: error.response?.data?.error?.message || error.message || "Unknown error",
      };
    }
  }

  async validateCredentials(
    credentials: any
  ): Promise<{ valid: boolean; error?: string }> {
    if (this.config.validateCredentials) {
      try {
        return await this.config.validateCredentials(credentials);
      } catch (error: any) {
        return {
          valid: false,
          error: error.message || "Credential validation failed",
        };
      }
    }
    return { valid: true };
  }

  private async resolveCredentials(
    credentials: any,
    input: CommunicationInput
  ): Promise<any> {
    const clientCreds = credentials?.client_json;
    if (!clientCreds) {
      return credentials;
    }

    if (this.config.authType !== "oauth") {
      return clientCreds;
    }

    // Merge client and token credentials
    const mergedCreds = {
      ...clientCreds,
      ...credentials?.token_json,
    };

    const { userId, credentialId } = this.normalizeIds(input);

    // Refresh OAuth token if needed
    return refreshOAuthTokenIfNeeded(
      this.serviceKey,
      mergedCreds,
      userId ?? "",
      credentialId ?? ""
    );
  }
}
