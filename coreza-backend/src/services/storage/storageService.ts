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

import type {
  IStorageService,
  StorageInput,
  StorageConfig,
  StorageContext,
} from "./types";
import type { StandardNodeOutput } from "../../types/nodeOutput";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../../utils/normalizeOutput";
import CredentialManager from "../../utils/credentialManager";
import { getUserRedisConnection } from "./helpers/redisConnection";
import { getRedisCache } from "../../config/redis";

export class StorageService implements IStorageService {
  readonly serviceKey: string;
  readonly requiresCredentials: boolean;
  private readonly config: StorageConfig;

  constructor(serviceKey: string, config: StorageConfig) {
    this.serviceKey = serviceKey;
    this.config = config;
    this.requiresCredentials = config.requiresCredentials;
  }

  private getContext() {
    return { nodeName: this.serviceKey, category: "storage" };
  }

  async execute(input: StorageInput): Promise<StandardNodeOutput> {
    try {
      const { operation, user_id, credential_id, workflow_id, subCategory } =
        input;

      if (!operation) {
        return createErrorOutput("Operation is required", this.getContext());
      }

      const operationConfig = this.config.operations[operation];
      if (!operationConfig) {
        return createErrorOutput(
          `Unknown operation: ${operation}`,
          this.getContext()
        );
      }

      // Build context
      const context: StorageContext = {
        userId: user_id,
        workflowId: workflow_id,
      };

      // Get Redis client based on service type
      if (this.requiresCredentials) {
        if (!credential_id) {
          return createErrorOutput(
            "credential_id is required",
            this.getContext()
          );
        }
        const credsResult = await CredentialManager.getCredentials(
          user_id,
          subCategory,
          credential_id
        );
        context.credentials = credsResult?.credentials;
        context.redis = await getUserRedisConnection(
          user_id,
          credential_id,
          context.credentials
        );
      } else {
        // Internal Redis (Store node)
        context.redis = getRedisCache();
      }

      // Execute operation
      const result = await operationConfig.handler(input, context);
      return createSuccessOutput(result, this.getContext());
    } catch (error: any) {
      return createErrorOutput(
        error.message || String(error),
        this.getContext()
      );
    }
  }
}
