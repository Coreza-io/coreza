/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
  private readonly contextMeta: {
    nodeName: string;
    category: string;
    skipTimestamp: boolean;
  };

  constructor(serviceKey: string, config: StorageConfig) {
    this.serviceKey = serviceKey;
    this.config = config;
    this.requiresCredentials = config.requiresCredentials;
    this.contextMeta = {
      nodeName: serviceKey,
      category: "storage",
      skipTimestamp: true,
    };
  }

  private getContext() {
    return this.contextMeta;
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

      const context: StorageContext = {
        userId: user_id || "",
        workflowId: workflow_id || "",
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
