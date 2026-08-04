/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export const RedisKeys = {
  // ── User scope ──
  userRun: (userId: string, runId: string): string =>
    `run:userId:${userId}:runId:${runId}`,
  userRunsPending: (userId: string): string =>
    `runqueue:userId:${userId}:pending`,

  // ── Workflow scope ──
  store: (userId: string, workflowId: string, varName: string): string =>
    `store:userId:${userId}:workflowId:${workflowId}:${varName}`,
  storePattern: (userId: string, workflowId: string): string =>
    `store:userId:${userId}:workflowId:${workflowId}:*`,

  strategyStream: (userId: string, workflowId: string): string =>
    `strategy:userId:${userId}:workflowId:${workflowId}:stream`,

  portfolioFillsStream: (userId: string, workflowId: string): string =>
    `fills:userId:${userId}:workflowId:${workflowId}:stream`,

  portfolioSnapshotLatest: (userId: string, workflowId: string): string =>
    `portfolio:userId:${userId}:workflowId:${workflowId}:snapshot`,

  order: (userId: string, workflowId: string, idempotencyKey: string): string =>
    `order:userId:${userId}:workflowId:${workflowId}:${idempotencyKey}`,
  orderReverse: (userId: string, workflowId: string, orderId: string): string =>
    `order:userId:${userId}:workflowId:${workflowId}:reverse:${orderId}`,

  persistent: (userId: string, workflowId: string, key: string): string =>
    `persistent:userId:${userId}:workflowId:${workflowId}:${key}`,

  // ── User-scoped discovery sets ──
  userActiveFillStreams: (userId: string): string =>
    `fills:userId:${userId}:active_streams`,
  userActiveSnapshotKeys: (userId: string): string =>
    `portfolio:userId:${userId}:active_keys`,

  // ── Execution scope ──
  indicator: (
    userId: string,
    workflowId: string,
    executionId: string,
    symbol: string,
    timeframe: string,
    indicator: string,
  ): string =>
    `indicator:userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:${symbol}:${timeframe}:${indicator}`,

  rollingWindow: (
    userId: string,
    workflowId: string,
    executionId: string,
    symbol: string,
    timeframe: string,
  ): string =>
    `RollingWindow:userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:${symbol}:${timeframe}`,

  executionPattern: (
    userId: string,
    workflowId: string,
    executionId: string,
  ): string =>
    `*:userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:*`,

  // ── Run scope ──
  nodeState: (
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
  ): string =>
    `nodestate:userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:${nodeId}`,

  // ── Loop scope ──
  loopMeta: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `loop:userId:${userId}:workflowId:${workflowId}:${parentRunId}:${loopId}:meta`,
  loopResults: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `loop:userId:${userId}:workflowId:${workflowId}:${parentRunId}:${loopId}:results`,
  loopAggregated: (
    userId: string,
    workflowId: string,
    parentRunId: string,
    loopId: string,
  ): string =>
    `loop:userId:${userId}:workflowId:${workflowId}:${parentRunId}:${loopId}:aggregated`,
  loopPattern: (userId: string, workflowId: string, parentRunId: string): string =>
    `loop:userId:${userId}:workflowId:${workflowId}:${parentRunId}:*`,

  // ── Global registries (minimal system discovery only) ──
  registryRunsPending: (): string => "registry:runs:pending",
  registryFillsActive: (): string => "registry:fills:active",
  registrySnapshotsActive: (): string => "registry:snapshots:active",

  backtestProgress: (userId: string, backtestId: string): string =>
    `backtest:userId:${userId}:backtestId:${backtestId}:progress`,
};
