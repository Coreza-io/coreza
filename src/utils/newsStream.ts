import { resultState, type NodeResult } from "./nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * Generic news stream utilities.
 * Not broker-specific — works with any news provider.
 */

export interface NewsPayload {
  id?: number;
  headline?: string;
  summary?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  content?: string;
  symbols?: string[];
  source?: string;
  [key: string]: any;
}

export interface NewsStreamOutput {
  message?: string;
  symbols?: string[];
  news: NewsPayload;
  lastReceivedAt?: string;
  nodeId?: string;
}

export const createWaitingNewsOutput = (
  overrides: Partial<NewsStreamOutput> = {}
): NodeResult<NewsStreamOutput> => resultState<NewsStreamOutput>("waiting", {
  message: overrides.message ?? "Waiting for news…",
  symbols: overrides.symbols ?? [],
  news: (overrides.news as NewsPayload) ?? {},
  lastReceivedAt: overrides.lastReceivedAt,
  nodeId: overrides.nodeId,
});

export const appendNewsItem = (
  prior: NodeResult<NewsStreamOutput> | undefined,
  news: NewsPayload,
  options: {
    nodeId?: string;
    symbols?: string[];
    receivedAt?: string;
  } = {}
): NodeResult<NewsStreamOutput> => {
  const current = prior?.data;
  const receivedAt = options.receivedAt ?? new Date().toISOString();

  return resultState<NewsStreamOutput>("streaming", {
    message: current?.message,
    symbols: options.symbols ?? news.symbols ?? current?.symbols ?? [],
    news,
    lastReceivedAt: receivedAt,
  });
};
