/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
import { isBrokerAuthError } from "../../utils/brokerAuthError";
import {
  claimOrderIntent,
  cacheReconciledOrder,
  generateIdempotencyKey,
  getOrderFromCache,
  releaseOrderClaim,
  takeOverOrderIntent,
  updateOrderCache,
  type CachedOrder,
} from "../../utils/orderIdempotency";
import { randomUUID } from "crypto";
import {
  normalizeOutput,
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import { OrderOwnerRegistry } from "../../services/OrderOwnerRegistry";
import {
  BROKER_CAPABILITIES,
  getOrderOwnerExtractor,
  getPlaceOrderEnrichment,
} from "../../brokers/capabilities";
import {
  getReconciliationCapability,
  resolveOrderKind,
} from "../../brokers/reconciliationCapabilities";

const RATE_LIMIT_DELAY_MS = 350; // ~170 requests/min, under 200 limit

export class BrokerExecutor implements INodeExecutor {
  readonly category = "Broker";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    let idempotencyKey: string | null = null;
    let orderOwnerToken: string | null = null;
    let orderToReconcile: CachedOrder | null = null;
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

      // Config-driven crypto symbol normalization
      const brokerCap = BROKER_CAPABILITIES[broker];
      if (
        brokerCap?.normalizeCryptoParams &&
        resolvedParams.assetType === "crypto"
      ) {
        brokerCap.normalizeCryptoParams(resolvedParams);
      }

      isOrderOperation =
        operation === "place_order" || operation === "close_position";

      if (isOrderOperation) {
        const orderKind = resolveOrderKind(broker, resolvedParams);
        const capability = getReconciliationCapability(broker, operation, orderKind);
        if (context?.emissionId && !capability.liveScanAllowed) {
          return {
            success: false,
            error: `SCAN_UNSAFE_OPERATION: ${broker}.${operation} cannot be safely reconciled`,
            code: "SCAN_UNSAFE_OPERATION",
          };
        }
        idempotencyKey = generateIdempotencyKey({
          workflowId,
          nodeId: node.id,
          runId: context?.emissionId ?? context?.runId ?? `manual-${Date.now()}`,
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
          const cached = await getOrderFromCache(userId, workflowId, idempotencyKey);
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
              orderToReconcile = cached;
            }
            if (cached.status === "failed" && resolvedParams.retry !== true) {
              const cachedError = cached.result && typeof cached.result === "object" && "error" in cached.result
                ? String(cached.result.error)
                : String(cached.result ?? "Order previously failed");
              return { success: false, data: cached.result, error: cachedError, meta: { cached: true } };
            }
            if (cached.status === "failed") orderToReconcile = cached;
          }
          if (!orderToReconcile) {
            orderOwnerToken = randomUUID();
            const claim = await claimOrderIntent(
              userId, workflowId, idempotencyKey, broker, orderOwnerToken,
              orderKind,
              String(resolvedParams.marketType ?? resolvedParams.asset_type ?? resolvedParams.assetType ?? "unknown"),
            );
            if (!claim.claimed) {
              const existing = claim.existing;
              if (existing?.status === "success") return { success: true, data: existing.result, meta: { cached: true } };
              if (!existing) return { success: false, error: "ORDER_IN_FLIGHT", meta: { cached: true, code: "ORDER_IN_FLIGHT" } };
              orderToReconcile = existing;
              orderOwnerToken = null;
            }
          }
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
        if (idempotencyKey && orderOwnerToken) {
          await releaseOrderClaim(userId, workflowId, idempotencyKey, orderOwnerToken);
          orderOwnerToken = null;
        }
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

      const headers = await config.makeAuthHeaders(workingCreds);

      if (isOrderOperation && idempotencyKey && orderToReconcile) {
        const reconciled = await this.reconcileOrder(
          config,
          orderToReconcile,
          idempotencyKey,
          resolvedParams,
          workingCreds,
          baseUrl,
          headers,
        );
        if (reconciled.found) {
          const orderId = this.extractOrderId(reconciled.result);
          await cacheReconciledOrder(
            userId,
            workflowId,
            idempotencyKey,
            orderToReconcile.ownerToken,
            orderToReconcile.updatedAt,
            reconciled.result,
            orderId,
          );
          return { success: true, data: reconciled.result, meta: { cached: true, reconciled: true } };
        }

        const staleMs = this.positiveEnv("ORDER_RECONCILE_STALE_MS", 60_000);
        const isStale = Date.now() - Date.parse(orderToReconcile.updatedAt) >= staleMs;
        const explicitRetry = orderToReconcile.status === "failed" && resolvedParams.retry === true;
        if ((!isStale && !explicitRetry) || !reconciled.supported || !reconciled.notFound) {
          return { success: false, error: "ORDER_IN_FLIGHT", meta: { cached: true, code: "ORDER_IN_FLIGHT" } };
        }
        orderOwnerToken = randomUUID();
        if (!(await takeOverOrderIntent(
          userId,
          workflowId,
          idempotencyKey,
          orderToReconcile.ownerToken,
          orderToReconcile.updatedAt,
          orderOwnerToken,
        ))) {
          return { success: false, error: "ORDER_IN_FLIGHT", meta: { cached: true, code: "ORDER_IN_FLIGHT" } };
        }
      }

      let data: any;

      if (op.execute) {
        console.log(`📤 [BROKER] Executing custom ${broker}.${operation}`);
        data = await op.execute({
          input: resolvedParams,
          creds: workingCreds,
          baseUrl,
          headers,
          request: axios,
        });
      } else {
        const path =
          typeof op.path === "function"
            ? op.path(resolvedParams, workingCreds)
            : op.path;

        const url = `${baseUrl}${path}`;
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
              clientOrderId: preRegisteredClientOrderId || "",
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
            ? op.transformResult(response.data, resolvedParams, response)
            : response.data;
        }
      }

      console.log(`✅ [BROKER] ${broker}.${operation} completed successfully`);

      if (operation === "place_order") {
        data = await this.enrichPlacedOrder({
          broker,
          data,
          config,
          baseUrl,
          headers,
          workingCreds,
        });
      }

      if (operation === "place_order") {
        try {
          const extractor = getOrderOwnerExtractor(broker);
          const ids = extractor ? extractor(data) : {};

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

      if (shouldPersistRedisState && isOrderOperation && idempotencyKey && orderOwnerToken) {
        const updated = await updateOrderCache(
          userId,
          workflowId,
          idempotencyKey,
          orderOwnerToken,
          "success",
          data,
          data?.orderId || data?.order_id || data?.id,
        );
        if (!updated) {
          console.warn(`Order ownership lost before success commit: ${idempotencyKey}`);
          return await this.canonicalOrderOutcome(userId, workflowId, idempotencyKey);
        }
      }

      const normalized = createSuccessOutput(data);
      return toNodeResult(normalized);
    } catch (error) {
      console.error(`❌ [BROKER] Execution failed:`, error);
      let enrichedError =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as any).response === "object" &&
        (error as any).response !== null &&
        "data" in (error as any).response
          ? (error as any).response.data
          : error instanceof Error
            ? error.message
            : String(error);

      if (axios.isAxiosError(error)) {
        const code = error.response?.data?.code;
        if (code === -4120) {
          const message = error.response?.data?.msg || error.message;
          enrichedError = new Error(
            `${message} (hint: Conditional order types must use algoOrder endpoint)`,
          );
        }
      }

      if (shouldPersistRedisState && isOrderOperation && idempotencyKey && orderOwnerToken) {
        const unknownOutcome = axios.isAxiosError(error) && !error.response;
        const updated = await updateOrderCache(userId, workflowId, idempotencyKey, orderOwnerToken, unknownOutcome ? "pending" : "failed", {
          error:
            enrichedError instanceof Error
              ? enrichedError.message
              : String(enrichedError),
        });
        if (!updated) {
          console.warn(`Order ownership lost before failure commit: ${idempotencyKey}`);
          return await this.canonicalOrderOutcome(userId, workflowId, idempotencyKey);
        }
      }

      if (isBrokerAuthError(error)) {
        return {
          success: false,
          error: error.message,
          code: error.code,
          provider: error.provider,
          recoverable: error.recoverable,
        };
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
        enrichedError instanceof Error
          ? enrichedError
          : typeof enrichedError === "object" && enrichedError !== null
            ? ((enrichedError as any).message ?? JSON.stringify(enrichedError))
            : String(enrichedError),
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

  private async reconcileOrder(
    config: NonNullable<ReturnType<typeof getBrokerConfig>>,
    cached: CachedOrder,
    idempotencyKey: string,
    resolvedParams: Record<string, unknown>,
    workingCreds: unknown,
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<{ supported: boolean; found: boolean; notFound: boolean; result?: unknown }> {
    if (cached.status === "failed") return { supported: true, found: false, notFound: true };
    const lookupOperation = cached.orderKind === "algo"
      ? "get_algo_order_by_client_id"
      : "get_order_by_client_id";
    const op = config.operations[lookupOperation];
    if (!op) return { supported: false, found: false, notFound: false };
    const input = { ...resolvedParams, client_order_id: idempotencyKey };
    try {
      if (op.execute) {
        const result = await op.execute({
          input,
          creds: workingCreds,
          baseUrl,
          headers,
          request: axios,
        });
        return { supported: true, found: true, notFound: false, result };
      }
      const path = typeof op.path === "function" ? op.path(input, workingCreds) : op.path;
      const body = op.makeBody ? await op.makeBody(input, workingCreds) : undefined;
      const response = await axios({
        method: op.method,
        url: `${baseUrl}${path}`,
        headers: body ? { ...headers, "Content-Type": "application/json" } : headers,
        params: op.makeParams?.(input, workingCreds) ?? {},
        data: body,
        timeout: 30_000,
      });
      const result = op.transformResult
        ? op.transformResult(response.data, input, response)
        : response.data;
      return { supported: true, found: true, notFound: false, result };
    } catch (error) {
      if (this.isOrderNotFound(error)) return { supported: true, found: false, notFound: true };
      return { supported: true, found: false, notFound: false };
    }
  }

  private async canonicalOrderOutcome(
    userId: string,
    workflowId: string,
    idempotencyKey: string,
  ): Promise<NodeResult> {
    const canonical = await getOrderFromCache(userId, workflowId, idempotencyKey);
    if (!canonical) {
      return { success: false, error: "ORDER_OWNERSHIP_LOST", code: "ORDER_OWNERSHIP_LOST" };
    }
    if (canonical.status === "success") {
      return { success: true, data: canonical.result, meta: { cached: true } };
    }
    const error = canonical.result && typeof canonical.result === "object" && "error" in canonical.result
      ? String((canonical.result as { error: unknown }).error)
      : canonical.status === "pending" ? "ORDER_IN_FLIGHT" : String(canonical.result ?? "Order failed");
    return { success: false, data: canonical.result, error, code: canonical.status === "pending" ? "ORDER_IN_FLIGHT" : undefined, meta: { cached: true } };
  }

  private isOrderNotFound(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    const brokerCode = error.response?.data?.code;
    return error.response?.status === 404 || brokerCode === -2013;
  }

  private extractOrderId(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const record = result as Record<string, unknown>;
    const value = record.orderId ?? record.order_id ?? record.id;
    return value === undefined || value === null ? undefined : String(value);
  }

  private positiveEnv(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async enrichPlacedOrder(input: {
    broker: string;
    data: unknown;
    config: NonNullable<ReturnType<typeof getBrokerConfig>>;
    baseUrl: string;
    headers: Record<string, string>;
    workingCreds: unknown;
  }): Promise<unknown> {
    const enrichment = getPlaceOrderEnrichment(input.broker);
    if (!enrichment) return input.data;

    const orderId = enrichment.getOrderId(input.data);
    if (!orderId) return input.data;

    const op = input.config.operations[enrichment.operation];
    if (!op) {
      console.warn(
        `⚠️ [BROKER] Missing ${input.broker}.${enrichment.operation} enrichment operation`,
      );
      return input.data;
    }

    const attempts = Math.max(1, enrichment.pollAttempts ?? 1);
    const delayMs = Math.max(0, enrichment.pollDelayMs ?? 0);

    let enrichedData = input.data;
    let enriched = false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (attempt > 1 && delayMs > 0) {
          await this.delay(delayMs);
        }

        const params = { orderId };
        const path =
          typeof op.path === "function"
            ? op.path(params, input.workingCreds)
            : op.path;
        const url = `${input.baseUrl}${path}`;
        const queryParams = op.makeParams?.(params, input.workingCreds) ?? {};
        const body = op.makeBody
          ? await op.makeBody(params, input.workingCreds)
          : undefined;

        const response = await axios({
          method: op.method,
          url,
          headers: body
            ? { ...input.headers, "Content-Type": "application/json" }
            : input.headers,
          params: queryParams,
          data: body,
          timeout: 30000,
        });

        const detail = op.transformResult
          ? op.transformResult(response.data, params, response)
          : response.data;

        enrichedData = enrichment.merge(input.data, detail);
        enriched = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (!enriched && lastError) {
      console.warn(
        `⚠️ [BROKER] Failed to enrich ${input.broker}.place_order response`,
        lastError,
      );
    }

    return enriched ? enrichedData : input.data;
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
    type RequestParams = Record<string, any>;
    let allData: Record<string, any[]> = {};
    let pageToken: string | null = null;
    let requestCount = 0;

    do {
      // Add page token if we have one
      const pageParams: RequestParams = {
        ...baseParams,
        ...(pageToken ? { [pagination.paramField]: pageToken } : {}),
      };

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
