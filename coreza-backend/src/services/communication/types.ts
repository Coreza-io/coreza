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

export interface CommunicationInput {
  user_id?: string;
  userId?: string;
  credential_id?: string;
  credentialId?: string;
  operation?: string;
  [key: string]: any;
}

export interface CommunicationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface CommunicationOperation {
  method: "get" | "post" | "put" | "delete";
  path: string | ((input: any, creds: any) => string);
  makeBody?: (input: any, creds: any) => any;
  makeParams?: (input: any, creds: any) => Record<string, any>;
  transformResult?: (data: any, input: any) => any;
  validateInput?: (input: any) => { valid: boolean; error?: string };
}

export interface CommunicationConfig {
  serviceKey: string;
  authType: "token" | "oauth" | "api_key";
  baseUrl: string | ((creds: any, input?: any) => string);

  // Credential field names to extract from request body for storage
  credentialFields: string[];

  // Credential validation (for auth endpoint)
  validateCredentials?: (
    credentials: any
  ) => Promise<{ valid: boolean; error?: string }>;

  // Auth header construction
  makeAuthHeaders: (
    creds: any
  ) => Record<string, string> | Promise<Record<string, string>>;

  // Operations map
  operations: Record<string, CommunicationOperation>;

  // Custom execute handler for complex services (like Gmail with OAuth SDK)
  customExecute?: (
    operation: string,
    input: CommunicationInput,
    creds: any
  ) => Promise<any>;
}

export interface ICommunicationService {
  readonly serviceKey: string;
  readonly config: CommunicationConfig;

  execute(input: CommunicationInput): Promise<CommunicationResult>;
  validateCredentials(
    credentials: any
  ): Promise<{ valid: boolean; error?: string }>;
}
