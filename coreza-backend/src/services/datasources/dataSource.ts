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
import { DataSourceInput, DataSourceResult, IDataSourceService } from "./types";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";

export type HttpMethod = "get" | "post" | "put" | "delete";

export interface DataSourceOperation {
  path: string | ((input: DataSourceInput) => string);
  method: HttpMethod;
  makeParams?: (input: DataSourceInput, creds?: any) => Record<string, any>;
  makeBody?: (input: DataSourceInput, creds?: any) => any;
  transformResult?: (data: any, input: DataSourceInput) => any;
  requiresCredentials?: boolean; // Default true
  timeout?: number; // Default 30000
}

export interface DataSourceConfig {
  authType?: "api_key" | "oauth" | "none";
  baseUrl: string | ((creds: any, input?: DataSourceInput) => string);
  makeAuthHeaders: (
    creds: any
  ) => Record<string, string> | Promise<Record<string, string>>;
  ops: Record<string, DataSourceOperation>;
  // For validation
  validateCredentials?: (apiKey: string) => Promise<{ valid: boolean; error?: string }>;
}

export class DataSourceService implements IDataSourceService {
  constructor(
    public readonly serviceKey: string,
    private readonly config: DataSourceConfig
  ) {}

  private handlers: Record<string, (input: DataSourceInput) => Promise<any>> =
    new Proxy(
      {},
      {
        get: (target, prop: string) => {
          return async (input: DataSourceInput) => {
            const op = this.config.ops[prop];
            if (!op) {
              throw new Error(`Operation ${prop} not configured for ${this.serviceKey}`);
            }

            const requiresCreds = op.requiresCredentials !== false;
            let creds = null;

            if (requiresCreds && input.credential_id) {
              const { credentials } = await this.getCredentials(
                input.user_id,
                input.credential_id
              );
              creds = await this.resolveCredentials(credentials, input);
            }

            const baseUrl =
              typeof this.config.baseUrl === "function"
                ? this.config.baseUrl(creds, input)
                : this.config.baseUrl;
            const path =
              typeof op.path === "function" ? op.path(input) : op.path;
            const url = `${baseUrl}${path}`;
            const headers = creds
              ? await this.config.makeAuthHeaders(creds)
              : {};
            const params = op.makeParams?.(input, creds) ?? {};
            const body = op.makeBody
              ? await op.makeBody(input, creds)
              : undefined;

            const axiosConfig: AxiosRequestConfig = {
              method: op.method,
              url,
              headers,
              params,
              timeout: op.timeout ?? 30_000,
            };

            if (["post", "put", "patch", "delete"].includes(op.method)) {
              axiosConfig.data = body;
            }

            console.log(
              `📊 [DataSourceService] Executing ${this.serviceKey}.${prop}:`,
              {
                url,
                method: op.method,
                params,
              }
            );

            const res = await axios.request(axiosConfig);
            const rawData = res.data;
            return op.transformResult
              ? op.transformResult(rawData, input)
              : rawData;
          };
        },
      }
    );

  async execute(input: DataSourceInput): Promise<DataSourceResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for data source: ${this.serviceKey}`,
      };
    }

    try {
      const data = await handler.call(this, input);
      return { success: true, data };
    } catch (error) {
      console.error(`[DataSourceService] ${this.serviceKey}.${input.operation} error:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async getCredentials(
    userId: string,
    credentialId: string
  ): Promise<any> {
    return CredentialManager.getCredentials(
      userId,
      this.serviceKey,
      credentialId
    );
  }

  private async resolveCredentials(
    credentials: any,
    input: DataSourceInput
  ): Promise<any> {
    const clientCreds = credentials?.client_json;
    if (!clientCreds) {
      return null;
    }

    if (this.config.authType !== "oauth") {
      return clientCreds;
    }

    const mergedCreds = {
      ...clientCreds,
      ...credentials?.token_json,
    };

    return refreshOAuthTokenIfNeeded(
      this.serviceKey,
      mergedCreds,
      input.user_id,
      input.credential_id ?? ""
    );
  }

  // Validate credentials for save operations
  async validateCredentials(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    if (this.config.validateCredentials) {
      return this.config.validateCredentials(apiKey);
    }
    return { valid: true };
  }
}
