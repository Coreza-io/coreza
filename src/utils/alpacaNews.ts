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
  status: 'waiting' | 'streaming';
  message?: string;
  nodeId?: string;
  symbols?: string[];
  items: AlpacaNewsPayload[];
  lastHeadline?: string;
  lastReceivedAt?: string;
  lastNews?: AlpacaNewsPayload;
  source?: string;
}

export const createWaitingNewsOutput = (
  overrides: Partial<AlpacaNewsOutput> = {}
): AlpacaNewsOutput => ({
  status: 'waiting',
  message: 'Waiting for news…',
  items: [],
  ...overrides,
});

export const appendNewsItem = (
  current: Partial<AlpacaNewsOutput> | undefined,
  news: AlpacaNewsPayload,
  options: {
    maxItems?: number;
    nodeId?: string;
    symbols?: string[];
    receivedAt?: string;
  } = {}
): AlpacaNewsOutput => {
  const maxItems = options.maxItems ?? 25;
  const existingItems = Array.isArray(current?.items)
    ? current!.items
    : [];
  const nextItems = [...existingItems, news].slice(-maxItems);

  return {
    status: 'streaming',
    message: current?.message,
    nodeId: options.nodeId ?? current?.nodeId,
    symbols: options.symbols ?? news.symbols ?? current?.symbols ?? [],
    items: nextItems,
    lastHeadline: news.headline ?? current?.lastHeadline,
    lastReceivedAt:
      options.receivedAt ??
      current?.lastReceivedAt ??
      new Date().toISOString(),
    lastNews: news,
    source: news.source ?? current?.source,
  };
};
