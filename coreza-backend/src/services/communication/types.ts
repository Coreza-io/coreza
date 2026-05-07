/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
