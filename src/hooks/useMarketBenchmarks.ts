import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { apiClient } from '@/lib/apiClient';
import type { MarketId } from '@/lib/marketSessions';
export interface BenchmarkQuote {
  market: MarketId; symbol: string; name: string; unit: string; available: boolean;
  change?: number; percent?: number; price?: number; asOf?: string; period?: string; source: string;
}
export class MarketQuoteRequestError extends Error {
  constructor(readonly code: 'unreachable' | 'timeout' | 'http', message: string, readonly status?: number) { super(message); }
}
export function quoteErrorLabel(error: unknown): string {
  if (!(error instanceof MarketQuoteRequestError)) return 'Quote unavailable';
  if (error.code === 'unreachable') return 'Backend unavailable';
  if (error.code === 'timeout') return 'Quote API timed out';
  if (error.status === 401 || error.status === 403) return 'Quote access denied';
  if (error.status === 404) return 'Quote API unavailable';
  return 'Quote unavailable';
}

// React Query shares requests/cache, but each observer otherwise owns an interval.
const pollers = new WeakMap<QueryClient, Map<string, { users: number; timer: ReturnType<typeof setInterval> }>>();
function validQuote(value: unknown, markets: readonly string[]): value is BenchmarkQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.market !== 'string' || !markets.includes(row.market) ||
    typeof row.symbol !== 'string' || !row.symbol || typeof row.name !== 'string' || !row.name ||
    typeof row.source !== 'string' || !row.source || typeof row.available !== 'boolean' ||
    row.unit !== (row.market === 'crypto' ? 'USD' : 'points')) return false;
  return !row.available || (
    typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 &&
    typeof row.change === 'number' && Number.isFinite(row.change) &&
    typeof row.percent === 'number' && Number.isFinite(row.percent) &&
    typeof row.asOf === 'string' && Number.isFinite(Date.parse(row.asOf)) &&
    typeof row.period === 'string' && row.period.length > 0
  );
}

/** Query cache shares one request across dashboard/sidebar; no tick-path subscription. */
export function useMarketBenchmarks() {
  const { user, session } = useAuth();
  const { selectedMarkets, loading, error } = useUserPreferences();
  const markets = selectedMarkets.join(',');
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['market-benchmarks', user?.id, markets], [user?.id, markets]);
  const enabled = !!user && !!session?.access_token && !loading && !error && !!markets;
  const query = useQuery({
    queryKey, enabled,
    staleTime: 60000, refetchInterval: false, retry: false,
    queryFn: async ({ signal }) => {
      let response: Response;
      try {
        response = await apiClient.request(`/market-quotes/benchmarks?markets=${encodeURIComponent(markets)}`, {
          token: session?.access_token, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof Error && error.name === 'TimeoutError') throw new MarketQuoteRequestError('timeout', 'The backend quote API did not respond in time.');
        throw new MarketQuoteRequestError('unreachable', 'Cannot reach the backend API. Check that the API service is running and its server URL is correct.');
      }
      if (!response.ok) throw new MarketQuoteRequestError('http', `Market quote API returned HTTP ${response.status}`, response.status);
      const data = await response.json();
      if (!Array.isArray(data?.quotes) || data.quotes.length !== selectedMarkets.length || !data.quotes.every((row: unknown) => validQuote(row, selectedMarkets)) || new Set(data.quotes.map((row: BenchmarkQuote) => row.market)).size !== data.quotes.length) throw new Error('Invalid benchmark response');
      return data.quotes as BenchmarkQuote[];
    },
  });
  useEffect(() => {
    if (!enabled) return;
    let entries = pollers.get(queryClient);
    if (!entries) { entries = new Map(); pollers.set(queryClient, entries); }
    const key = JSON.stringify(queryKey);
    let poller = entries.get(key);
    if (!poller) {
      poller = { users: 0, timer: setInterval(() => {
        if (!document.hidden) void queryClient.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
      }, 60000) };
      entries.set(key, poller);
    }
    poller.users++;
    return () => {
      if (--poller.users === 0) { clearInterval(poller.timer); entries.delete(key); }
      if (!entries.size) pollers.delete(queryClient);
    };
  }, [enabled, queryClient, queryKey]);
  return query;
}
export function benchmarkChange(quote?: BenchmarkQuote): string {
  if (!quote?.available || !Number.isFinite(quote.change) || !Number.isFinite(quote.percent)) return 'Quote unavailable';
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4, signDisplay: 'always',
    ...(quote.unit === 'USD' ? { style: 'currency', currency: 'USD' } : {}) }).format(quote.change!);
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'always' }).format(quote.percent!);
  return `${amount}${quote.unit === 'points' ? ' pts' : ''} (${percent}%)`;
}
