import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { apiClient } from '@/lib/apiClient';
import type { MarketId } from '@/lib/marketSessions';
export interface BenchmarkQuote {
  market: MarketId; symbol: string; name: string; unit: string; available: boolean;
  change?: number; percent?: number; price?: number; asOf?: string; period?: string; source: string;
}
/** Query cache shares one request across dashboard/sidebar; no tick-path subscription. */
export function useMarketBenchmarks() {
  const { user, session } = useAuth();
  const { selectedMarkets, loading, error } = useUserPreferences();
  const markets = selectedMarkets.join(',');
  return useQuery({
    queryKey: ['market-benchmarks', user?.id, markets],
    enabled: !!user && !!session?.access_token && !loading && !error && !!markets,
    staleTime: 60000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: false,
    queryFn: async ({ signal }) => {
      const response = await apiClient.request(`/market-quotes/benchmarks?markets=${encodeURIComponent(markets)}`, {
        token: session?.access_token, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error('Benchmark quotes unavailable');
      const data = await response.json();
      if (!Array.isArray(data.quotes)) throw new Error('Invalid benchmark response');
      return data.quotes as BenchmarkQuote[];
    },
  });
}
export function benchmarkChange(quote?: BenchmarkQuote): string {
  if (!quote?.available || !Number.isFinite(quote.change) || !Number.isFinite(quote.percent)) return 'Quote unavailable';
  const amount = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4, signDisplay: 'always',
    ...(quote.unit === 'USD' ? { style: 'currency', currency: 'USD' } : {}) }).format(quote.change!);
  const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, signDisplay: 'always' }).format(quote.percent!);
  return `${amount}${quote.unit === 'points' ? ' pts' : ''} (${percent}%)`;
}
