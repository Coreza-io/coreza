/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

interface BuildExecutionKeyConfig {
  userId: string;
  workflowId: string;
  runId: string;
  scope: string;
  nodeId?: string;
  parts?: Array<string | number>;
}

export function buildExecutionScopedKey(config: BuildExecutionKeyConfig): string {
  const segments: Array<string | number> = [
    "user",
    config.userId,
    "workflow",
    config.workflowId,
    "runId",
    config.runId,
  ];

  if (config.nodeId) {
    segments.push("node", config.nodeId);
  }

  segments.push(config.scope);

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
