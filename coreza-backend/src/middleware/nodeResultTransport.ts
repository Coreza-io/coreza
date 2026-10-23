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
import { isNodeResult, readNodeResult, resultFailure, serializeNodeResult } from "../contracts/nodeResult";

/** Current node operation transport. Every producer emits the status/data contract. */
export const nodeResultTransport: RequestHandler = (req, res, next) => {
  const nodePath = req.method === "POST" && /^\/(?:indicators\/[^/]+|comparator\/(?:if|switch|field|compute)|risk\/engine|http\/request|documents\/extract|portfolio\/?|aiagent\/execute|backtest\/(?:init|onbar|trade|portfolio|results)|broker\/[^/]+\/(?!auth$)[^/]+|datasource\/[^/]+\/(?!auth$)[^/]+|screener\/[^/]+\/[^/]+|communication\/[^/]+\/(?!auth$)[^/]+|googlesearch\/execute|execute\/scheduler|webhooks\/register|stream\/[^/]+\/(?:register|subscribe|unsubscribe)|storage\/(?:store|redis|redisTrigger)\/(?!auth$)[^/]+|storage\/(?:rolling-window|consolidator))$/.test(req.path);
  if (!nodePath && !(typeof req.body?.node_id === "string" && typeof req.body?.nodeName === "string")) return next();
  const send = res.json.bind(res);
  res.json = ((body: any) => {
    const { variableSnapshot, agentActivity, ...value } = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
    // Shared auth/error middleware has its own HTTP error protocol.
    let result = !isNodeResult(value) && res.statusCode >= 400
      ? resultFailure(typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "Node request failed", { details: { status: res.statusCode } })
      : readNodeResult(value);
    if (res.statusCode === 499) result = { ...result, status: "cancelled" };
    return send({ ...serializeNodeResult(result, { omitSeries: true }), ...(variableSnapshot !== undefined ? { variableSnapshot } : {}), ...(agentActivity !== undefined ? { agentActivity } : {}) });
  }) as typeof res.json;
  next();
};
