/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import axios, { AxiosRequestConfig } from "axios";
import { ScreenerInput, ScreenerResult, IScreenerService } from "./types";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";

export type HttpMethod = "get" | "post" | "put" | "delete";

export interface ScreenerOperation {
  path: string | ((input: ScreenerInput) => string);
  method: HttpMethod;
  makeParams?: (input: ScreenerInput, creds?: any) => Record<string, any>;
  makeBody?: (input: ScreenerInput, creds?: any) => any;
  transformResult?: (data: any, input: ScreenerInput) => any;
}

export interface ScreenerConfig {
  authType?: "api_key" | "oauth";
  baseUrl: string | ((creds: any, input?: ScreenerInput) => string);
  makeAuthHeaders: (
    creds: any
  ) => Record<string, string> | Promise<Record<string, string>>;
  ops: Record<string, ScreenerOperation>;
}

export class ScreenerService implements IScreenerService {
  constructor(
    public readonly screenerKey: string,
    private readonly config: ScreenerConfig
  ) {}

  private handlers: Record<string, (input: ScreenerInput) => Promise<any>> =
    new Proxy(
      {},
      {
        get: (target, prop: string) => {
          return async (input: ScreenerInput) => {
            const op = this.config.ops[prop];
            if (!op) {
              throw new Error(`Operation ${prop} not configured`);
            }

            let creds = null;
            if (input.credential_id) {
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
              timeout: 30_000,
            };

            if (["post", "put", "patch", "delete"].includes(op.method)) {
              axiosConfig.data = body;
            }

            console.log(
              `📊 [ScreenerService] Executing ${this.screenerKey}.${prop}:`,
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

  async execute(input: ScreenerInput): Promise<ScreenerResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for screener: ${this.screenerKey}`,
      };
    }

    try {
      const data = await handler.call(this, input);
      return { success: true, data };
    } catch (error) {
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
      this.screenerKey,
      credentialId
    );
  }

  private async resolveCredentials(
    credentials: any,
    input: ScreenerInput
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
      this.screenerKey,
      mergedCreds,
      input.user_id,
      input.credential_id ?? ""
    );
  }
}
