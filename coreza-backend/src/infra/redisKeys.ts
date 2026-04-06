/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export const RedisKeys = {
  // ── User scope ──
  userRun: (userId: string, executionId: string): string =>
    `userId:${userId}:runId:${executionId}`,
  userRunsPending: (userId: string): string =>
    `userId:${userId}:runs:pending`,

  // ── Workflow scope ──
  store: (userId: string, workflowId: string, varName: string): string =>
    `userId:${userId}:workflowId:${workflowId}:store:${varName}`,
  storePattern: (userId: string, workflowId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:store:*`,

  strategyStream: (userId: string, workflowId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:strategy:stream`,

  portfolioFillsStream: (userId: string, workflowId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:portfolio:fills:stream`,

  portfolioSnapshotLatest: (userId: string, workflowId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:portfolio:snapshot:latest`,

  order: (userId: string, workflowId: string, idempotencyKey: string): string =>
    `userId:${userId}:workflowId:${workflowId}:order:${idempotencyKey}`,
  orderReverse: (userId: string, workflowId: string, orderId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:orderReverse:${orderId}`,

  persistent: (userId: string, workflowId: string, key: string): string =>
    `userId:${userId}:workflowId:${workflowId}:persistent:${key}`,

  // ── User-scoped discovery sets ──
  userActiveFillStreams: (userId: string): string =>
    `userId:${userId}:portfolio:fills:active_streams`,
  userActiveSnapshotKeys: (userId: string): string =>
    `userId:${userId}:portfolio:snapshots:active_keys`,

  // ── Execution scope ──
  indicator: (
    userId: string,
    workflowId: string,
    executionId: string,
    symbol: string,
    timeframe: string,
    indicator: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:ind:${symbol}:${timeframe}:${indicator}`,

  rollingWindow: (
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
    symbol: string,
    timeframe: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:rw:${nodeId}:${symbol}:${timeframe}`,

  executionPattern: (
    userId: string,
    workflowId: string,
    executionId: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:*`,

  // ── Run scope ──
  nodeState: (
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:node:${nodeId}`,

  // ── Loop scope ──
  loopMeta: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:loop:${parentRunId}:${loopId}:meta`,
  loopResults: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:loop:${parentRunId}:${loopId}:results`,
  loopAggregated: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `userId:${userId}:workflowId:${workflowId}:loop:${parentRunId}:${loopId}:aggregated`,
  loopPattern: (userId: string, workflowId: string, parentRunId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:loop:${parentRunId}:*`,

  // ── Global registries (minimal system discovery only) ──
  registryRunsPending: (): string => "registry:users:runs:pending",
  registryFillsActive: (): string => "registry:users:fills:active",
  registrySnapshotsActive: (): string => "registry:users:snapshots:active",
};
