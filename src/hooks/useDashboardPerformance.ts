import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { reportingPages } from '@/lib/reportingPages';
import { useScopedLoader } from './useScopedLoader';

export const UNKNOWN_CURRENCY = '__unknown';
interface PerformancePoint { date: string; value: number }
interface Group { currency: string; points: PerformancePoint[]; total: number; runCount: number; tradeCount: number }
interface Dataset { groups: Group[]; excluded: number; loadedAt: string }
const empty = (): Dataset => ({ groups: [], excluded: 0, loadedAt: '' });
const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const currencyOf = (parent: { base_currency: string | null; metrics_context: unknown }) => {
  const source = record(record(parent.metrics_context)?.snapshot_source);
  const snapshotCurrency = source?.base_currency;
  if (typeof parent.base_currency === 'string' && typeof snapshotCurrency === 'string' && parent.base_currency.trim() && snapshotCurrency.trim() && parent.base_currency.trim().toUpperCase() !== snapshotCurrency.trim().toUpperCase()) return UNKNOWN_CURRENCY;
  const value = parent.base_currency || snapshotCurrency;
  return typeof value === 'string' && /^[a-z0-9]{2,12}$/i.test(value.trim()) ? value.trim().toUpperCase() : UNKNOWN_CURRENCY;
};

/** History reporting only; no execution-loop I/O. */
export function useDashboardPerformance() {
  const { user } = useAuth();
  const scope = useMemo(() => ({ id: user?.id }), [user?.id]);
  const [state, setState] = useState({ scope, data: empty(), loading: true, error: null as string | null });
  const [selection, setSelection] = useState({ scope, currency: '' });
  const performLoad = useCallback(async (isCurrent: () => boolean) => {
    if (!user) return;
    setState(previous => ({ scope, data: previous.scope === scope ? previous.data : empty(), loading: true, error: null }));
    try {
      const now = new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const start = new Date(end.getTime() - 30 * 86400000);
      const keys = Array.from({ length: 30 }, (_, i) => new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
      const rows = await reportingPages<{
        id: string; live_strategy_id: string; exitTime: string; net_pnl: unknown;
        live_strategies: { base_currency: string | null; metrics_context: unknown };
      }>(() => supabase.from('trades')
        .select('id, live_strategy_id, exitTime, net_pnl, live_strategies!inner(base_currency, metrics_context)')
        .eq('user_id', user.id).eq('live_strategies.user_id', user.id).eq('live_strategies.mode', 'live')
        .gte('exitTime', start.toISOString()).lt('exitTime', end.toISOString()).order('exitTime').order('id'));
      const groups = new Map<string, { buckets: Map<string, number>; runs: Set<string>; count: number }>();
      const seen = new Set<string>();
      let excluded = 0;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const value = numeric(row.net_pnl);
        const exit = typeof row.exitTime === 'string' ? Date.parse(row.exitTime) : NaN;
        if (value === null || !Number.isFinite(exit) || exit < start.getTime() || exit >= end.getTime() || !row.live_strategies) { excluded++; continue; }
        const currency = currencyOf(row.live_strategies);
        let group = groups.get(currency);
        if (!group) { group = { buckets: new Map(keys.map(key => [key, 0])), runs: new Set(), count: 0 }; groups.set(currency, group); }
        const key = new Date(exit).toISOString().slice(0, 10);
        group.buckets.set(key, group.buckets.get(key)! + value);
        group.runs.add(row.live_strategy_id); group.count++;
      }
      const result = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, group]) => ({
        currency, points: [...group.buckets].map(([date, value]) => ({ date, value })),
        total: [...group.buckets.values()].reduce((a, b) => a + b, 0), runCount: group.runs.size, tradeCount: group.count,
      }));
      if (isCurrent()) setState({ scope, data: { groups: result, excluded, loadedAt: now.toISOString() }, loading: false, error: null });
    } catch (error) {
      if (isCurrent()) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Unable to load live P/L' }));
    }
  }, [scope, user?.id]);
  const refresh = useScopedLoader(user?.id ?? '', performLoad);
  useEffect(() => { if (user) void refresh(); }, [user?.id, refresh]);
  useEffect(() => {
    if (!user) return;
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh); };
  }, [user?.id, refresh]);
  const current = state.scope === scope ? state : { scope, data: empty(), loading: !!user, error: null };
  const selected = current.data.groups.find(group => selection.scope === scope && group.currency === selection.currency) ?? current.data.groups[0];
  return { ...current, selected, refresh, selectCurrency: (currency: string) => setSelection({ scope, currency }) };
}

export function formatPerformance(value: number, currency: string, compact = false): string {
  const options: Intl.NumberFormatOptions = { maximumFractionDigits: compact ? 1 : 2, ...(compact ? { notation: 'compact' as const } : {}) };
  // Token codes (e.g. USDT) and unknown denominations are not ISO currencies.
  if (/^[A-Z]{3}$/.test(currency) && currency !== UNKNOWN_CURRENCY) {
    try { return new Intl.NumberFormat('en-US', { ...options, style: 'currency', currency }).format(value); } catch { /* Use explicit units below. */ }
  }
  return `${new Intl.NumberFormat('en-US', options).format(value)}${currency === UNKNOWN_CURRENCY ? '' : ` ${currency}`}`;
}
