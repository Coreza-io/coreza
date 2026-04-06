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
  executionId?: string;
  runId?: string;
  scope: string;
  nodeId?: string;
  parts?: Array<string | number>;
}

export function buildExecutionScopedKey(config: BuildExecutionKeyConfig): string {
  const executionId = config.executionId ?? config.runId;
  if (!executionId) {
    throw new Error("buildExecutionScopedKey requires executionId (or legacy runId)");
  }

  if (config.scope === "indicator" && config.parts && config.parts.length >= 3) {
    const [symbol, timeframe, indicator] = config.parts;
    return RedisKeys.indicator(
      config.userId,
      config.workflowId,
      executionId,
      String(symbol),
      String(timeframe),
      String(indicator),
    );
  }

  if (config.nodeId) {
    return RedisKeys.nodeState(
      config.userId,
      config.workflowId,
      executionId,
      executionId,
      config.nodeId,
    );
  }

  const segments: Array<string | number> = [
    `userId:${config.userId}`,
    `workflowId:${config.workflowId}`,
    `sessionId:${executionId}`,
    `executionId:${executionId}`,
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
  executionId: string,
  symbol: string,
  timeframe: string,
  indicator: string,
): string {
  return buildExecutionScopedKey({
    userId,
    workflowId,
    executionId,
    scope: "indicator",
    parts: [symbol, timeframe, indicator],
  });
}
