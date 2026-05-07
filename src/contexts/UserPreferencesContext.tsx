/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface UserPreferences {
  timezone: string;
  loading: boolean;
  updateTimezone: (timezone: string) => Promise<void>;
}

const UserPreferencesContext = createContext<UserPreferences | undefined>(undefined);

export const UserPreferencesProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [timezone, setTimezone] = useState<string>('UTC');
  const [loading, setLoading] = useState(true);

  // Load user's timezone preference on mount
  useEffect(() => {
    const loadTimezone = async () => {
      if (!user) {
        setTimezone('UTC');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('timezone')
        .eq('user_id', user.id)
        .single();

      if (data && !error) {
        setTimezone(data.timezone || 'UTC');
      }
      setLoading(false);
    };

    loadTimezone();
  }, [user]);

  const updateTimezone = async (newTimezone: string) => {
    if (!user) return;

    const { error } = await supabase
      .from('users')
      .update({ timezone: newTimezone })
      .eq('user_id', user.id);

    if (!error) {
      setTimezone(newTimezone);
    }
  };

  return (
    <UserPreferencesContext.Provider value={{ timezone, loading, updateTimezone }}>
      {children}
    </UserPreferencesContext.Provider>
  );
};

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error('useUserPreferences must be used within UserPreferencesProvider');
  return context;
};
