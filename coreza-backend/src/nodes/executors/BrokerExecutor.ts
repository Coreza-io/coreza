import { resultSuccess, resultFailure } from "../../contracts/nodeResult";
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
import { performance } from "perf_hooks";
import { LOG } from "../../utils/logging";
import { LIVE_TIMING_ENABLED, observeLive, observeEpoch, orderSubmitHttp, orderStage, liveSignalToSubmit, liveReceiptToSubmit, countLive, type LiveExecutionTiming } from "../../utils/liveTiming";
import { historicalRowCount, safeToolError, toolInputFields, traceToolHttp, ToolExecutionTrace } from "../../utils/toolExecutionLog";
import {
  getBrokerConfig,
  BrokerOperation,
  PaginationConfig,
} from "../../brokers";
import CredentialManager from "../../utils/credentialManager";
import type { CredentialLookupEvent } from "../../utils/credentialCache";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";
import { formatBrokerAuthenticationFailure, isBrokerAuthError } from "../../utils/brokerAuthError";
import {
  cacheOrderIntent,
  generateIdempotencyKey,
  getOrderFromCache,
  updateOrderCache,
} from "../../utils/orderIdempotency";
import { createSuccessOutput, createErrorOutput } from "../../utils/nodeResultHelpers";
import { OrderOwnerRegistry } from "../../services/OrderOwnerRegistry";
import {
  BROKER_CAPABILITIES,
  getOrderOwnerExtractor,
  getPlaceOrderEnrichment,
} from "../../brokers/capabilities";

const RATE_LIMIT_DELAY_MS = 350; // ~170 requests/min, under 200 limit

const disabledTradeTiming = {
  configure: (_broker: string, _operation: string) => {},
  mark: (_phase: string) => {},
  wrap: (client: typeof axios) => client,
  source: (_name: string, _source: unknown) => {},
  credentialLookup: undefined,
  finish: (_fields: Record<string, unknown>) => {},
};

// Keep timing local to one invocation; never log request bodies, credentials or responses.
function createTradeTiming(enabled: boolean, liveTiming?: LiveExecutionTiming) {
  if (!enabled) return disabledTradeTiming;
  const started = enabled ? performance.now() : 0;
  const measure = LIVE_TIMING_ENABLED;
  let metricBroker = "other";
  let metricOperation = "place_order";
  const phasesMs: Record<string, number> = {};
  const sources: Record<string, unknown> = {};
  const credentialLookups: CredentialLookupEvent[] = [];
  let phase = "setup";
  let phaseStarted = started;
  let httpMs = 0;
  let httpRequestCount = 0;
  let httpFailureCount = 0;
  const mark = (next: string) => {
    if (!enabled) return;
    const now = performance.now();
    phasesMs[phase] = (phasesMs[phase] ?? 0) + now - phaseStarted;
    if (measure) observeLive(orderStage, { stage: phase, outcome: "settled" }, (now - phaseStarted) / 1000);
    phase = next;
    phaseStarted = now;
  };
  const observe = async (invoke: () => any, method: string) => {
    const submission = measure && phase === "brokerOperation" && ["post", "put", "patch", "delete", "postform", "putform", "patchform"].includes(method.toLowerCase());
    const firstSubmission = submission && !!liveTiming && !liveTiming.submitted;
    if (firstSubmission && liveTiming) {
      liveTiming.submitted = true;
    }
    let outcome = "success";
    httpRequestCount += 1;
    const submissionEpoch = firstSubmission ? Date.now() : 0;
    const begin = performance.now();
    try {
      return await invoke();
    } catch (error) {
      outcome = "error";
      httpFailureCount += 1;
      throw error;
    } finally {
      const elapsedMs = performance.now() - begin;
      httpMs += elapsedMs;
      // Observe after capturing the request interval so collector work is not HTTP latency.
      if (firstSubmission && liveTiming) {
        observeLive(liveSignalToSubmit, { event_kind: liveTiming.eventKind, outcome: "submitted" }, (begin - liveTiming.executionStartedAt) / 1000);
        observeEpoch(liveReceiptToSubmit, "receipt_to_submit", liveTiming.ingress?.barEligibleAt ?? liveTiming.ingress?.gatewayReceivedAt, submissionEpoch, liveTiming.eventKind, "submitted");
      }
      if (submission) observeLive(orderSubmitHttp, { broker: metricBroker, operation: metricOperation, outcome }, elapsedMs / 1000);
    }
  };
  const methods = new Set(["request", "get", "delete", "head", "options", "post", "put", "patch", "postForm", "putForm", "patchForm"]);
  const wrap = (client: typeof axios): typeof axios => !enabled ? client : new Proxy(client, {
    apply(target, receiver, args) {
      const config = typeof args[0] === "string" ? args[1] : args[0];
      return observe(() => Reflect.apply(target, receiver, args), config?.method ?? "get");
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "create" && typeof value === "function") {
        return (...args: any[]) => wrap(Reflect.apply(value, target, args));
      }
      return typeof property === "string" && methods.has(property) && typeof value === "function"
        ? (...args: any[]) => observe(() => Reflect.apply(value, target, args), property === "request" ? args[0]?.method ?? "get" : property)
        : value;
    },
  });
  return {
    configure: (broker: string, operation: string) => {
      metricBroker = ["alpaca", "binance", "dhan", "schwab"].includes(broker) ? broker : "other";
      metricOperation = operation === "close_position" ? "close_position" : "place_order";
    },
    mark,
    wrap,
    source: (name: string, source: unknown) => { if (enabled && LOG) sources[name] = source; },
    credentialLookup: enabled && LOG ? (event: CredentialLookupEvent) => {
      credentialLookups.push(event);
      if (event.outcome === "hit") sources.credentials = event.source;
    } : undefined,
    finish: (fields: Record<string, unknown>) => {
      if (!enabled) return;
      mark("finished");
      if (measure) countLive("order", String(fields.status));
      if (!LOG) return;
      const totalMs = performance.now() - started;
      const round = (ms: number) => +ms.toFixed(3);
      // HTTP is summed across requests, so it can exceed wall time for concurrent custom operations.
      // The residual below uses exclusive phase wall times rather than subtracting summed HTTP time.
      const brokerOperationMs = phasesMs.brokerOperation ?? 0;
      const enrichmentMs = phasesMs.enrichment ?? 0;
      try {
        console.info("[TRADE_TIMING]", {
          ...fields,
          totalMs: round(totalMs),
          brokerOperationMs: round(brokerOperationMs),
          enrichmentMs: round(enrichmentMs),
          otherWorkMs: round(Math.max(0, totalMs - brokerOperationMs - enrichmentMs)),
          httpMs: round(httpMs),
          httpRequestCount,
          httpFailureCount,
          sources,
          credentialLookups,
          phasesMs: Object.fromEntries(Object.entries(phasesMs).map(([name, ms]) => [name, round(ms)])),
        });
      } catch { /* Diagnostics must not change the order result. */ }
    },
  };
}

export class BrokerExecutor implements INodeExecutor {
  readonly category = "Broker";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const orderOperation = ["place_order", "close_position"].includes(node.values?.operation);
    const timing = createTradeTiming(orderOperation && (LOG || LIVE_TIMING_ENABLED), orderOperation ? context?.liveTiming : undefined);
    let timingStatus = "error";
    const startTime = Date.now();
    let idempotencyKey: string | null = null;
    let isOrderOperation = false;
    let shouldPersistRedisState = true;
    const userId = context?.userId ?? "system";
    const workflowId = context?.workflowId ?? "manual";
    let operation = "";
    let broker = "";
    let apiKeyRequest = false;
    let credentialLabel: string | undefined;
    let requestHost: string | undefined;
    let requestEnvironment: string | undefined;
    let fetchStart: number | undefined;
    let requestCount = () => 0;

    let preRegisteredClientOrderId: string | null = null;
    try {
      operation = node.values?.operation;
      const brokerNode = node as WorkflowNode & { subCategory: string };
      broker = (brokerNode.subCategory ?? node.name).toLowerCase();
      timing.configure(broker, operation);
      const credential_id = node.values?.credential_id;
      //shouldPersistRedisState = context?.executionMode === "live";

      if (!credential_id) {
        return resultFailure(`${broker || "Broker"} credential_id is required`, { data: null });
      }

      // Get broker config (in-memory lookup, no HTTP)
      const config = getBrokerConfig(broker);
      if (LOG) timing.source("brokerConfig", "in_memory_registry");
      if (!config) {
        return resultFailure(`Unsupported broker: ${broker}`, { data: null });
      }

      const op = config.operations[operation];
      if (!op) {
        return resultFailure(`Unsupported operation: ${operation} for ${broker}`, { data: null });
      }

      timing.mark("parameters");
      if (LOG) timing.source("parameters", {
        nodeValues: "in_memory_node_snapshot",
        input: "in_memory_execution_input",
        resolution: context?.resolveNodeParameters ? "execution_context_resolver" : "node_values_input_merge",
      });
      // Resolve and merge node parameters with input data
      if (LOG) console.log(
        `🔧 [BROKER] Starting parameter resolution for node ${node.id}`,
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      if (LOG) console.log(
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
      context?.agentDataTrace?.('broker_parameters', () => ({ broker, operation,
        fields: toolInputFields(resolvedParams, operation) }), 'debug');
      const transport = context?.agentDataTrace ? traceToolHttp(axios, context.agentDataTrace, resolvedParams) : undefined;
      const request = timing.wrap(transport?.client ?? axios);
      if (transport) requestCount = transport.requestCount;

      isOrderOperation =
        operation === "place_order" || operation === "close_position";

      timing.mark("idempotency");
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
          if (LOG) timing.source("idempotency", { storage: "redis_cache", outcome: "attempted" });
          const cached = await getOrderFromCache(
            userId,
            workflowId,
            idempotencyKey,
          );
          if (LOG) timing.source("idempotency", { storage: "redis_cache", outcome: cached ? `hit_${cached.status}` : "miss" });
          if (cached) {
            if (cached.status === "success") {
              if (LOG) console.log(
                `🔒 [IDEMPOTENCY] Returning cached order: ${idempotencyKey}`,
              );
              timingStatus = "cached";
              return resultSuccess(cached.result, { meta: { cached: true } });
            }

            if (cached.status === "pending") {
              timingStatus = "pending";
              return resultFailure("Order is already being processed", { data: null, meta: { cached: true } });
            }
          }

          await cacheOrderIntent(userId, workflowId, idempotencyKey, broker);
        }
        resolvedParams._idempotencyKey = idempotencyKey;
      }

      timing.mark("credentials");
      if (LOG) timing.source("credentials", "not_resolved");
      // Fetch credentials directly (no HTTP)
      const { credentials } = await CredentialManager.getCredentials(
        context?.userId,
        broker,
        credential_id,
        { useCache: shouldPersistRedisState, onLookup: timing.credentialLookup },
      );

      if (!credentials) {
        if (LOG) timing.source("credentials", "not_found_or_error");
        return resultFailure(`Credentials not found for ${broker}`, { data: null });
      }

      // credential_id is the saved name: CredentialManager resolves it with eq("name", ...),
      // including on cache hits. Its returned payload contains no display-label field.
      credentialLabel = typeof credential_id === "string" ? credential_id : undefined;
      const creds = credentials.client_json;

      timing.mark("authentication");
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

      apiKeyRequest = config.authType === "api_key";
      requestHost = new URL(baseUrl).hostname;
      if (broker === "alpaca") {
        requestEnvironment = requestHost === "paper-api.alpaca.markets"
          ? "Paper Trading"
          : requestHost === "api.alpaca.markets" ? "Live Trading" : undefined;
      }

      timing.mark("requestPreparation");
      let data: any;
      fetchStart = performance.now();

      if (op.execute) {
        if (LOG) console.log(`📤 [BROKER] Executing custom ${broker}.${operation}`);
        timing.mark("brokerOperation");
        data = await op.execute({
          input: resolvedParams,
          creds: workingCreds,
          baseUrl,
          headers,
          request,
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
          timing.mark("ownerBeforeRequest");
          if (LOG) timing.source("ownerBeforeRequest", "redis_queue");
          preRegisteredClientOrderId = resolvedParams._idempotencyKey.trim();
          try {
            await OrderOwnerRegistry.saveOwner({
              source: `${broker}_trading`,
              userId,
              workflowId,
              nodeId: node.id,
              runId: context?.runId,
              reportingExecutionId: context?.reportingExecutionId ?? (context?.executionMode === "live" ? context.executionId : undefined),
              symbol: String(resolvedParams?.symbol || ""),
              createdAt: new Date().toISOString(),
              clientOrderId: preRegisteredClientOrderId || "",
            });
          } catch (err) {
            console.warn("Failed to pre-save order-owner mapping", safeToolError(err));
          }
        }

        timing.mark("requestPreparation");
        if (LOG) console.log(`📤 [BROKER] Executing ${broker}.${operation}`);

        // Check if pagination is enabled and requested
        const autoPaginate = resolvedParams.auto_paginate !== false; // Default true
        const maxPages = Number(resolvedParams.max_pages) || 100;
        const pagination = op.pagination;
        context?.agentDataTrace?.('broker_options', () => ({ broker, operation,
          effectiveOptions: { auto_paginate: autoPaginate, max_pages: maxPages, paginationEnabled: !!pagination?.enabled } }), 'debug');

        timing.mark("brokerOperation");
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
            context?.agentDataTrace,
            request,
          );
        } else {
          // Single request (no pagination or disabled)
          const response = await request({
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

      timing.mark("responseProcessing");
      context?.agentDataTrace?.('broker_fetch', () => ({ durationMs: performance.now() - fetchStart!, broker, operation,
        requestCount: requestCount(), transformedRowCount: operation === 'get_candle' ? historicalRowCount(data, resolvedParams.symbol) : null }));
      fetchStart = undefined;
      if (LOG) console.log(`✅ [BROKER] ${broker}.${operation} completed successfully`);

      if (operation === "place_order") {
        timing.mark("enrichment");
        data = await this.enrichPlacedOrder({
          broker,
          data,
          config,
          baseUrl,
          headers,
          workingCreds,
          request,
        });
      }

      timing.mark("ownerAfterRequest");
      if (isOrderOperation) {
        if (LOG) timing.source("ownerAfterRequest", "redis_queue");
        try {
          const extractor = getOrderOwnerExtractor(broker);
          const ids = extractor ? extractor(data) : {};

          // Keep this post-response save:
          // - pre-save (before request) protects early WS fills via clientOrderId
          // - post-save enriches mapping with broker-assigned IDs (orderId/algoId),
          //   which later lifecycle events may reference instead of clientOrderId.
          // - close_position also creates an order; its response IDs must be
          //   registered even when the broker cannot accept a client ID upfront.
          // This is broker-agnostic: any broker may emit later lifecycle events with
          // broker-native IDs rather than clientOrderId.
          await OrderOwnerRegistry.saveOwner({
            source: `${broker}_trading`,
            userId,
            workflowId,
            nodeId: node.id,
            runId: context?.runId,
            reportingExecutionId: context?.reportingExecutionId ?? (context?.executionMode === "live" ? context.executionId : undefined),
            symbol: String(resolvedParams?.symbol || ""),
            createdAt: new Date().toISOString(),
            ...ids,
          });
        } catch (err) {
          console.warn("Failed to save order-owner mapping", safeToolError(err));
        }
      }

      timing.mark("orderCache");
      if (shouldPersistRedisState && isOrderOperation && idempotencyKey) {
        if (LOG) timing.source("orderCache", "redis_cache");
        await updateOrderCache(
          userId,
          workflowId,
          idempotencyKey,
          "success",
          data,
          data?.orderId || data?.order_id || data?.id,
        );
      }

      timing.mark("result");
      const normalized = createSuccessOutput(data);
      timingStatus = "success";
      return normalized;
    } catch (error) {
      timing.mark("errorHandling");
      if (fetchStart !== undefined) context?.agentDataTrace?.('broker_fetch', {
        durationMs: performance.now() - fetchStart, operation, success: false,
      });
      console.error(`❌ [BROKER] Execution failed:`, safeToolError(error));
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

      if (apiKeyRequest && axios.isAxiosError(error) && error.response?.status === 401 && !isBrokerAuthError(error)) {
        enrichedError = formatBrokerAuthenticationFailure({
          provider: broker,
          nodeName: node.displayName || node.data?.displayName || node.id || node.name || "Broker",
          operation,
          credentialLabel,
          environment: requestEnvironment,
          requestHost,
        });
      }

      if (shouldPersistRedisState && isOrderOperation && idempotencyKey) {
        if (LOG) timing.source("orderCache", "redis_cache");
        await updateOrderCache(userId, workflowId, idempotencyKey, "failed", {
          error:
            enrichedError instanceof Error
              ? enrichedError.message
              : String(enrichedError),
        });
      }

      if (isBrokerAuthError(error)) {
        return resultFailure(error.message, { data: null, details: { code: error.code, provider: error.provider, recoverable: error.recoverable } });
      }

      if (preRegisteredClientOrderId && operation === "place_order") {
        try {
          await OrderOwnerRegistry.deleteOwnerIds(`${broker}_trading`, {
            clientOrderId: preRegisteredClientOrderId,
          });
        } catch (cleanupErr) {
          console.warn(
            "Failed to cleanup pre-saved order-owner mapping",
            safeToolError(cleanupErr),
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
      return normalized;
    } finally {
      if (orderOperation && (LOG || LIVE_TIMING_ENABLED)) timing.finish({
        workflowId,
        nodeId: node.id,
        runId: context?.runId ?? context?.executionId,
        executionId: context?.reportingExecutionId ?? context?.executionId,
        broker,
        operation,
        status: timingStatus,
      });
    }
  }

  private async enrichPlacedOrder(input: {
    broker: string;
    data: unknown;
    config: NonNullable<ReturnType<typeof getBrokerConfig>>;
    baseUrl: string;
    headers: Record<string, string>;
    workingCreds: unknown;
    request?: typeof axios;
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

        const response = await (input.request ?? axios)({
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
        safeToolError(lastError),
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
    trace?: ToolExecutionTrace,
    request: typeof axios = axios,
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

      const pageStart = performance.now();
      trace?.('broker_page_request', () => ({ page: requestCount + 1, request: {
        query: toolInputFields(pageParams, operation), body: toolInputFields(body, operation, true),
      } }), 'debug');
      const response = await request({
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

      trace?.('broker_page', () => ({ page: requestCount, durationMs: performance.now() - pageStart,
        rawRowCount: operation === 'get_candle' ? historicalRowCount(responseData, resolvedParams.symbol) : null,
        hasNextPage: !!pageToken }));
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


