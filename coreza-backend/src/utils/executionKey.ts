/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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

  if (
    config.scope === "rolling_window" &&
    config.parts &&
    config.parts.length >= 2
  ) {
    const [symbol, timeframe] = config.parts;
    return RedisKeys.rollingWindow(
      config.userId,
      config.workflowId,
      executionId,
      String(symbol),
      String(timeframe),
    );
  }

  if (config.nodeId) {
    return RedisKeys.nodeState(
      config.userId,
      config.workflowId,
      executionId,
      config.nodeId,
    );
  }

  const segments: Array<string | number> = [
    config.scope,
    `userId:${config.userId}`,
    `workflowId:${config.workflowId}`,
    `executionId:${executionId}`,
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
