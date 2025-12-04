/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export interface AlpacaNewsPayload {
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

export interface AlpacaNewsOutput {
  status: "waiting" | "streaming";
  message?: string;
  symbols?: string[];
  news: AlpacaNewsPayload; // <-- single object
  lastReceivedAt?: string;
  nodeId?: string;
}

export const createWaitingNewsOutput = (
  overrides: Partial<AlpacaNewsOutput> = {}
): AlpacaNewsOutput => ({
  status: "waiting",
  message: overrides.message ?? "Waiting for news…",
  symbols: overrides.symbols ?? [],
  news: (overrides.news as AlpacaNewsPayload) ?? {}, // start empty object
  lastReceivedAt: overrides.lastReceivedAt,
  nodeId: overrides.nodeId,
});

export const appendNewsItem = (
  current: Partial<AlpacaNewsOutput> | undefined,
  news: AlpacaNewsPayload,
  options: {
    nodeId?: string;
    symbols?: string[];
    receivedAt?: string;
  } = {}
): AlpacaNewsOutput => {
  const receivedAt = options.receivedAt ?? new Date().toISOString();

  return {
    status: "streaming",
    message: current?.message,
    symbols: options.symbols ?? news.symbols ?? current?.symbols ?? [],
    news, // <-- assign the single latest news object
    lastReceivedAt: receivedAt,
  };
};
