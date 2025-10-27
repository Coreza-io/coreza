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
