/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { Redis } from "ioredis";
import type { StandardNodeOutput } from "../../types/nodeOutput";

export interface StorageInput {
  user_id: string;
  credential_id?: string;
  operation: string;
  workflow_id?: string;
  workflowId?: string;
  // Common fields
  key?: string;
  variableName?: string;
  variableNameManual?: string;
  variableNameSelect?: string;
  variableSource?: string;
  sourceWorkflowId?: string;
  value?: any;
  ttl?: number;
  scope?: string;
  keyType?: string;
  // Hash fields
  hashField?: string;
  // Set fields
  members?: string | string[];
  member?: string;
  setMember?: string;
  otherKeys?: string | string[];
  // List fields
  popDirection?: string;
  pushDirection?: string;
  startIndex?: number;
  endIndex?: number;
  index?: number;
  // Sorted set fields
  score?: number;
  scoreMembers?: string | Array<{ score: number; member: string }>;
  withScores?: boolean | string;
  reverseOrder?: boolean | string;
  minScore?: string | number;
  maxScore?: string | number;
  // Pub/Sub fields
  channel?: string;
  channels?: string | string[];
  channelPattern?: string;
  subscription_type?: "channel" | "pattern";
  // Utility fields
  pattern?: string;
  incrementBy?: number;
  // Trigger-specific fields
  node_id?: string;
  // Extended params
  [key: string]: any;
}

export interface StorageResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface IStorageService {
  readonly serviceKey: string;
  readonly requiresCredentials: boolean;
  execute(input: StorageInput): Promise<StandardNodeOutput>;
  validateCredentials?(credentials: any): Promise<{ valid: boolean; error?: string }>;
}

export interface StorageContext {
  userId: string;
  workflowId?: string;
  redis?: Redis;
  credentials?: any;
}

export type StorageOperationHandler = (
  input: StorageInput,
  context: StorageContext
) => Promise<any>;

export interface StorageOperation {
  handler: StorageOperationHandler;
  requiresKey?: boolean;
  requiresValue?: boolean;
  description?: string;
}

export interface StorageConfig {
  requiresCredentials: boolean;
  operations: Record<string, StorageOperation>;
}
