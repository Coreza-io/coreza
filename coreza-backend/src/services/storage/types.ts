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
