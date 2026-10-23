/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { RequestHandler } from "express";
import { decodeLegacyNodeResult, isNodeResult, resultFailure, resultSuccess, serializeNodeResult } from "../contracts/nodeResult";

/** Explicit editor node invocation boundary. Metadata, credentials and workflow-run APIs are untouched. */
export const nodeResultTransport: RequestHandler = (req, res, next) => {
  const canonicalRequest = req.get("X-Coreza-Node-Result") === "canonical";
  // Known node-operation routes also support older clients that omit editor identity fields.
  const legacyNodePath = req.method === "POST" && /^\/(?:indicators\/[^/]+|comparator\/(?:if|switch|field|compute)|risk\/engine|http\/request|documents\/extract|portfolio\/?|aiagent\/execute|backtest\/(?:init|onbar|trade|portfolio|results)|broker\/[^/]+\/[^/]+|datasource\/[^/]+\/[^/]+|storage\/(?:store|redis)\/[^/]+|storage\/(?:rolling-window|consolidator))$/.test(req.path);
  const legacyNodeInvocation = legacyNodePath || (typeof req.body?.node_id === "string" && typeof req.body?.nodeName === "string");
  if (!canonicalRequest && !legacyNodeInvocation) return next();
  const send = res.json.bind(res);
  res.json = ((body: any) => {
    // Named legacy HTTP adapter: old clients still receive their success flag.
    // This flag is never added to executor, store, history or canonical editor results.
    if (!canonicalRequest) {
      const { variableSnapshot, agentActivity, ...value } = body && typeof body === "object" && !Array.isArray(body) ? body : {};
      if (!isNodeResult(value)) return send(body);
      const result = serializeNodeResult(value, { omitSeries: true });
      return send({ ...result, success: !["error", "cancelled", "not-executed"].includes(result.status),
        ...(result.details?.code !== undefined ? { code: result.details.code } : {}),
        ...(result.details?.provider !== undefined ? { provider: result.details.provider } : {}),
        ...(result.details?.recoverable !== undefined ? { recoverable: result.details.recoverable } : {}),
        ...(variableSnapshot !== undefined ? { variableSnapshot } : {}), ...(agentActivity !== undefined ? { agentActivity } : {}) });
    }
    // These are transport attachments, not business payload or node metadata.
    const { variableSnapshot, agentActivity, ...value } = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
    const raw = body !== null && typeof body === "object" && !Array.isArray(body) ? value : body;
    let result = isNodeResult(raw) ? raw : req.body?.nodeName === "HttpRequest" && typeof raw?.status === "number"
      ? { ...(res.statusCode >= 400 ? resultFailure(raw.message || raw.error || "HTTP request failed", { data: raw.data }) : resultSuccess(raw.data)),
          meta: { http: { status: raw.status, statusText: raw.statusText, headers: raw.headers } },
          ...(res.statusCode >= 400 ? { details: { status: raw.status } } : {}) } : decodeLegacyNodeResult(raw, "manual");
    if (res.statusCode >= 400 && result.status !== "error" && result.status !== "cancelled") {
      result = resultFailure(typeof raw?.message === "string" ? raw.message : typeof raw?.error === "string" ? raw.error : "Node request failed", {
        data: result.data, meta: result.meta, details: { status: res.statusCode, ...(typeof raw?.code === "string" ? { code: raw.code } : {}) },
      });
    }
    if (res.statusCode === 499) result = { ...result, status: "cancelled" };
    return send({ ...serializeNodeResult(result, { omitSeries: true }), ...(variableSnapshot !== undefined ? { variableSnapshot } : {}), ...(agentActivity !== undefined ? { agentActivity } : {}) });
  }) as typeof res.json;
  next();
};
