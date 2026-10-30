/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_MARKETS, normalizeMarkets, type MarketId } from '@/lib/marketSessions';

interface UserPreferences {
  timezone: string;
  selectedMarkets: MarketId[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  updateTimezone: (timezone: string) => Promise<void>;
  updateSelectedMarkets: (markets: MarketId[]) => Promise<void>;
}
const UserPreferencesContext = createContext<UserPreferences | undefined>(undefined);
export const UserPreferencesProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const scope = useMemo(() => ({ userId: user?.id }), [user?.id]);
  const current = useRef(scope); current.current = scope;
  const busy = useRef<object | null>(null);
  const [state, setState] = useState({ scope, timezone: 'UTC', selectedMarkets: [...DEFAULT_MARKETS], loading: true, saving: false, error: null as string | null });
  const visible = state.scope === scope ? state : { scope, timezone: 'UTC', selectedMarkets: [] as MarketId[], loading: !!user, saving: false, error: null };
  useEffect(() => {
    let disposed = false;
    setState({ scope, timezone: 'UTC', selectedMarkets: [], loading: !!scope.userId, saving: false, error: null });
    if (!scope.userId) return;
    void (async () => {
      try {
        const { data, error } = await supabase.from('users').select('timezone, selected_markets').eq('user_id', scope.userId!).single();
        if (error) throw error;
        if (disposed || current.current !== scope) return;
        setState({ scope, timezone: data.timezone || 'UTC', selectedMarkets: normalizeMarkets(data.selected_markets), loading: false, saving: false, error: null });
      } catch (error) {
        if (!disposed && current.current === scope) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'Unable to load preferences' }));
      }
    })();
    return () => { disposed = true; };
  }, [scope]);

  const save = async (patch: { timezone?: string; selected_markets?: MarketId[] }) => {
    if (current.current !== scope || !scope.userId || visible.loading || visible.error) throw new Error('Preferences are not ready. Reload Settings and try again.');
    if (busy.current === scope) throw new Error('A preference save is already in progress.');
    busy.current = scope;
    setState(previous => ({ ...previous, saving: true }));
    try {
      const { data, error } = await supabase.from('users').update(patch).eq('user_id', scope.userId).select('user_id').single();
      if (error) throw error;
      if (!data || current.current !== scope) throw new Error('Account changed before preferences were saved.');
      setState(previous => ({ ...previous, ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.selected_markets !== undefined ? { selectedMarkets: patch.selected_markets } : {}) }));
    } finally {
      if (busy.current === scope) busy.current = null;
      if (current.current === scope) setState(previous => ({ ...previous, saving: false }));
    }
  };
  return <UserPreferencesContext.Provider value={{ ...visible,
    updateTimezone: timezone => save({ timezone }),
    updateSelectedMarkets: markets => save({ selected_markets: normalizeMarkets(markets) }),
  }}>{children}</UserPreferencesContext.Provider>;
};
export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  return context;
};
