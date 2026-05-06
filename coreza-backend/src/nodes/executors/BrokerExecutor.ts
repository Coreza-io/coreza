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

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import {
  getBrokerConfig,
  BrokerOperation,
  PaginationConfig,
} from "../../brokers";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";
import {
  cacheOrderIntent,
  generateIdempotencyKey,
  getOrderFromCache,
  updateOrderCache,
} from "../../utils/orderIdempotency";
import {
  normalizeOutput,
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import { OrderOwnerRegistry } from "../../services/OrderOwnerRegistry";
import { extractAlpacaOrderOwnerIds } from "../../brokers/alpaca/orderOwnerExtract";
import { extractBinanceOrderOwnerIds } from "../../brokers/binance/orderOwnerExtract";

const RATE_LIMIT_DELAY_MS = 350; // ~170 requests/min, under 200 limit

const KNOWN_CRYPTO_QUOTES = ["USD", "USDT", "USDC", "BTC"];

function toCanonicalCryptoSymbol(symbol: string): string {
  const fallbackSymbol = "ETH/USD";

  if (!symbol || typeof symbol !== "string") return fallbackSymbol;

  const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
  if (upperSymbol.includes("/")) {
    const [rawBase, rawQuote] = upperSymbol.split("/");
    if (rawBase && rawQuote) return `${rawBase}/${rawQuote}`;
    return fallbackSymbol;
  }

  const detectedQuote = KNOWN_CRYPTO_QUOTES.find(
    (quote) => upperSymbol.endsWith(quote) && upperSymbol.length > quote.length,
  );

  if (detectedQuote) {
    const base = upperSymbol.slice(0, -detectedQuote.length);
    return `${base}/${detectedQuote}`;
  }

  return fallbackSymbol;
}

function normalizeAlpacaCryptoSymbol(params: Record<string, any>) {
  const fallbackSymbol = "ETH/USD";
  const normalizePair = (base: string, quote: string) =>
    `${base.toUpperCase().trim()}/${quote.toUpperCase().trim()}`;

  if (params.crypto_base) {
    const quote = params.crypto_quote || "USD";
    params.symbol = normalizePair(params.crypto_base, quote);
    return;
  }

  if (typeof params.symbol !== "string" || params.symbol.trim() === "") {
    params.symbol = fallbackSymbol;
    return;
  }

  params.symbol = toCanonicalCryptoSymbol(params.symbol);
}

export class BrokerExecutor implements INodeExecutor {
  readonly category = "Broker";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    let idempotencyKey: string | null = null;
    let isOrderOperation = false;
    let shouldPersistRedisState = true;
    const userId = context?.userId ?? "system";
    const workflowId = context?.workflowId ?? "manual";
    let operation = "";
    let broker = "";

    let preRegisteredClientOrderId: string | null = null;
    try {
      operation = node.values?.operation;
      const brokerNode = node as WorkflowNode & { subCategory: string };
      broker = (brokerNode.subCategory ?? node.name).toLowerCase();
      const credential_id = node.values?.credential_id;
      //shouldPersistRedisState = context?.executionMode === "live";

      if (!credential_id) {
        return {
          success: false,
          error: `${broker || "Broker"} credential_id is required`,
        };
      }

      // Get broker config (in-memory lookup, no HTTP)
      const config = getBrokerConfig(broker);
      if (!config) {
        return {
          success: false,
          error: `Unsupported broker: ${broker}`,
        };
      }

      const op = config.operations[operation];
      if (!op) {
        return {
          success: false,
          error: `Unsupported operation: ${operation} for ${broker}`,
        };
      }

      // Resolve and merge node parameters with input data
      console.log(
        `🔧 [BROKER] Starting parameter resolution for node ${node.id}`,
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `🔧 [BROKER] Parameter resolution completed for node ${node.id}`,
      );

      if (broker === "alpaca" && resolvedParams.assetType === "crypto") {
        normalizeAlpacaCryptoSymbol(resolvedParams);
      }

      isOrderOperation =
        operation === "place_order" || operation === "close_position";

      if (isOrderOperation) {
        idempotencyKey = generateIdempotencyKey({
          workflowId,
          nodeId: node.id,
          runId: context?.runId ?? `manual-${Date.now()}`,
          symbol: resolvedParams.symbol ?? "",
          side:
            operation === "close_position"
              ? "close"
              : (resolvedParams.side ??
                resolvedParams.instruction ??
                resolvedParams.transactionType ??
                ""),
          quantity:
            resolvedParams.quantity ??
            resolvedParams.qty ??
            resolvedParams.percentage ??
            resolvedParams.notional ??
            "full",
        });

        if (shouldPersistRedisState) {
          const cached = await getOrderFromCache(
            userId,
            workflowId,
            idempotencyKey,
          );
          if (cached) {
            if (cached.status === "success") {
              console.log(
                `🔒 [IDEMPOTENCY] Returning cached order: ${idempotencyKey}`,
              );
              return {
                success: true,
                data: cached.result,
                meta: { cached: true },
              };
            }

            if (cached.status === "pending") {
              return {
                success: false,
                error: "Order is already being processed",
                meta: { cached: true },
              };
            }
          }

          await cacheOrderIntent(userId, workflowId, idempotencyKey, broker);
        }
        resolvedParams._idempotencyKey = idempotencyKey;
      }

      // Fetch credentials directly (no HTTP)
      const { credentials } = await CredentialManager.getCredentials(
        context?.userId,
        broker,
        credential_id,
        { useCache: shouldPersistRedisState },
      );

      if (!credentials) {
        return {
          success: false,
          error: `Credentials not found for ${broker}`,
        };
      }

      const creds = credentials.client_json;

      // Handle OAuth token refresh if needed
      let workingCreds = creds;
      if (config.authType === "oauth") {
        workingCreds = await refreshOAuthTokenIfNeeded(
          broker,
          creds,
          context?.userId,
          credential_id,
        );
      }

      // Build request to EXTERNAL broker API
      const baseUrl =
        typeof config.baseUrl === "function"
          ? config.baseUrl(workingCreds, resolvedParams)
          : config.baseUrl;

      const path =
        typeof op.path === "function"
          ? op.path(resolvedParams, workingCreds)
          : op.path;

      const url = `${baseUrl}${path}`;
      const headers = await config.makeAuthHeaders(workingCreds);
      const params = op.makeParams?.(resolvedParams, workingCreds) ?? {};
      const body = op.makeBody
        ? await op.makeBody(resolvedParams, workingCreds)
        : undefined;
      const shouldPreRegisterOrderOwner =
        operation === "place_order" &&
        typeof resolvedParams?._idempotencyKey === "string" &&
        resolvedParams._idempotencyKey.trim().length > 0;

      if (shouldPreRegisterOrderOwner) {
        preRegisteredClientOrderId = resolvedParams._idempotencyKey.trim();
        try {
          await OrderOwnerRegistry.saveOwner({
            source: `${broker}_trading`,
            userId,
            workflowId,
            nodeId: node.id,
            runId: context?.runId,
            symbol: String(resolvedParams?.symbol || ""),
            createdAt: new Date().toISOString(),
            clientOrderId: preRegisteredClientOrderId,
          });
        } catch (err) {
          console.warn("Failed to pre-save order-owner mapping", err);
        }
      }

      console.log(`📤 [BROKER] Executing ${broker}.${operation} → ${url}`);

      // Check if pagination is enabled and requested
      const autoPaginate = resolvedParams.auto_paginate !== false; // Default true
      const maxPages = Number(resolvedParams.max_pages) || 100;
      const pagination = op.pagination;

      let data: any;

      if (pagination?.enabled && autoPaginate) {
        // Execute with automatic pagination
        data = await this.executeWithPagination(
          op,
          url,
          headers,
          params,
          body,
          resolvedParams,
          pagination,
          maxPages,
          broker,
          operation,
        );
      } else {
        // Single request (no pagination or disabled)
        const response = await axios({
          method: op.method,
          url,
          headers: body
            ? { ...headers, "Content-Type": "application/json" }
            : headers,
          params,
          data: body,
          timeout: 30000,
        });

        data = op.transformResult
          ? op.transformResult(response.data, resolvedParams)
          : response.data;
      }

      console.log(`✅ [BROKER] ${broker}.${operation} completed successfully`);

      if (operation === "place_order") {
        try {
          const ids =
            broker === "alpaca"
              ? extractAlpacaOrderOwnerIds(data)
              : broker === "binance"
                ? extractBinanceOrderOwnerIds(data)
                : "";

          // Keep this post-response save:
          // - pre-save (before request) protects early WS fills via clientOrderId
          // - post-save enriches mapping with broker-assigned IDs (orderId/algoId),
          //   which later lifecycle events may reference instead of clientOrderId.
          // This is broker-agnostic: any broker may emit later lifecycle events with
          // broker-native IDs rather than clientOrderId.
          await OrderOwnerRegistry.saveOwner({
            source: `${broker}_trading`,
            userId,
            workflowId,
            nodeId: node.id,
            runId: context?.runId,
            symbol: String(resolvedParams?.symbol || ""),
            createdAt: new Date().toISOString(),
            ...ids,
          });
        } catch (err) {
          console.warn("Failed to save order-owner mapping", err);
        }
      }

      if (shouldPersistRedisState && isOrderOperation && idempotencyKey) {
        await updateOrderCache(
          userId,
          workflowId,
          idempotencyKey,
          "success",
          data,
          data?.orderId || data?.order_id || data?.id,
        );
      }

      const normalized = createSuccessOutput(data);
      return toNodeResult(normalized);
    } catch (error) {
      console.error(`❌ [BROKER] Execution failed:`, error);
      let enrichedError = error.response.data;

      if (axios.isAxiosError(error)) {
        const code = error.response?.data?.code;
        if (code === -4120) {
          const message = error.response?.data?.msg || error.message;
          enrichedError = new Error(
            `${message} (hint: Conditional order types must use algoOrder endpoint)`,
          );
        }
      }

      if (shouldPersistRedisState && isOrderOperation && idempotencyKey) {
        await updateOrderCache(userId, workflowId, idempotencyKey, "failed", {
          error:
            enrichedError instanceof Error
              ? enrichedError.message
              : String(enrichedError),
        });
      }

      if (preRegisteredClientOrderId && operation === "place_order") {
        try {
          await OrderOwnerRegistry.deleteOwnerIds(`${broker}_trading`, {
            clientOrderId: preRegisteredClientOrderId,
          });
        } catch (cleanupErr) {
          console.warn(
            "Failed to cleanup pre-saved order-owner mapping",
            cleanupErr,
          );
        }
      }

      const normalized = createErrorOutput(
        enrichedError instanceof Error ? enrichedError : String(enrichedError),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
          startTime,
        },
      );
      return toNodeResult(normalized);
    }
  }

  private async executeWithPagination(
    op: BrokerOperation,
    baseUrl: string,
    headers: Record<string, string>,
    baseParams: Record<string, any>,
    body: any,
    resolvedParams: any,
    pagination: PaginationConfig,
    maxPages: number,
    broker: string,
    operation: string,
  ): Promise<any> {
    let allData: Record<string, any[]> = {};
    let pageToken: string | null = null;
    let requestCount = 0;

    do {
      // Add page token if we have one
      const pageParams = pageToken
        ? { ...baseParams, [pagination.paramField]: pageToken }
        : baseParams;

      // Rate limit between requests (except first)
      if (requestCount > 0) {
        await this.delay(RATE_LIMIT_DELAY_MS);
      }

      const response = await axios({
        method: op.method,
        url: baseUrl,
        headers: body
          ? { ...headers, "Content-Type": "application/json" }
          : headers,
        params: pageParams,
        data: body,
        timeout: 30000,
      });

      // Extract data from response
      const responseData = response.data;
      const pageData = responseData[pagination.dataField];

      // Merge data based on strategy
      if (pagination.mergeStrategy === "concat") {
        if (typeof pageData === "object" && !Array.isArray(pageData)) {
          Object.entries(pageData).forEach(([symbol, value]) => {
            if (Array.isArray(value)) {
              if (!allData[symbol]) {
                allData[symbol] = [];
              }

              allData[symbol] = allData[symbol].concat(value);
            }
          });
        }
      }

      // Get next page token
      pageToken = responseData[pagination.tokenField] || null;
      requestCount++;

      console.log(
        `📊 [BROKER] ${broker}.${operation} page ${requestCount}: ${allData.length} total items`,
      );
    } while (pageToken && requestCount < maxPages);

    // Build merged response for transformResult
    const mergedResponse = {
      [pagination.dataField]: allData,
      next_page_token: pageToken,
    };

    // Transform and add pagination metadata
    const transformed = op.transformResult
      ? op.transformResult(mergedResponse, resolvedParams)
      : mergedResponse;

    return {
      ...transformed,
      pages_fetched: requestCount,
      pagination_complete: !pageToken,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
