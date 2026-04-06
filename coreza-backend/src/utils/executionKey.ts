/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { RedisKeys } from "../infra/redisKeys";

interface BuildExecutionKeyConfig {
  userId: string;
  workflowId: string;
  runId: string;
  scope: string;
  nodeId?: string;
  parts?: Array<string | number>;
  sessionId?: string;
}

export function buildExecutionScopedKey(config: BuildExecutionKeyConfig): string {
  const sessionId = config.sessionId ?? config.runId;

  if (config.scope === "indicator" && config.parts && config.parts.length >= 3) {
    const [symbol, timeframe, indicator] = config.parts;
    return RedisKeys.indicator(
      config.userId,
      config.workflowId,
      sessionId,
      String(symbol),
      String(timeframe),
      String(indicator),
    );
  }

  if (config.nodeId) {
    return RedisKeys.nodeState(
      config.userId,
      config.workflowId,
      sessionId,
      config.runId,
      config.nodeId,
    );
  }

  const segments: Array<string | number> = [
    `userId:${config.userId}`,
    `workflowId:${config.workflowId}`,
    `sessionId:${sessionId}`,
    `runId:${config.runId}`,
    config.scope,
  ];

  if (config.parts?.length) {
    segments.push(...config.parts);
  }

  return segments.join(":");
}

export function buildIndicatorKey(
  userId: string,
  workflowId: string,
  runId: string,
  symbol: string,
  timeframe: string,
  indicator: string,
): string {
  return buildExecutionScopedKey({
    userId,
    workflowId,
    runId,
    scope: "indicator",
    parts: [symbol, timeframe, indicator],
  });
}
