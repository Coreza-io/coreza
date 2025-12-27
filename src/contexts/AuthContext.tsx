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

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AUTH_EXPIRED_EVENT, apiClient } from '@/lib/apiClient';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Inactivity timeout in milliseconds (default: 4 hours)
const INACTIVITY_TIMEOUT = parseInt(import.meta.env.VITE_INACTIVITY_TIMEOUT || '14400000'); // 4 hours

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const userRef = useRef<User | null>(null);
  
  // Navigation for redirects - wrapped in try/catch for cases outside Router
  let navigate: ReturnType<typeof useNavigate> | null = null;
  let location: ReturnType<typeof useLocation> | null = null;
  try {
    navigate = useNavigate();
    location = useLocation();
  } catch {
    // Component is used outside of Router context (e.g., in tests)
  }

  const clearLocalSessionState = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    setSession(null);
    setUser(null);

    // Force clear Supabase localStorage tokens to ensure clean state
    localStorage.removeItem('sb-tiitofotheupylvxivge-auth-token');
  }, []);

  const signOut = useCallback(async () => {
    // Get current session token BEFORE signing out (for cleanup API call)
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    
    // Call cleanup endpoint FIRST (while we still have auth)
    if (currentSession?.access_token) {
      try {
        await apiClient.post(
          '/market/cleanup-user-streams',
          {},
          currentSession.access_token
        );
        console.log('✅ Cleaned up user streams on sign out');
      } catch (error) {
        console.error('Failed to cleanup streams on sign out:', error);
        // Continue with sign out even if cleanup fails
      }
    }
    
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error (will clear local state anyway):', error);
    }

    // ALWAYS clear local state, even if server signOut fails
    // This handles the case where session is already expired on server
    clearLocalSessionState();
  }, [clearLocalSessionState]);

  const handleSessionError = useCallback(async (error: unknown) => {
    const authError = error as { code?: string; message?: string } | null;

    if (authError?.code === 'refresh_token_not_found') {
      console.warn('Supabase session is stale (refresh token missing). Signing out.');
      await signOut();
      setLoading(false);
      return true;
    }

    return false;
  }, [signOut]);

  // Listen for global 401 responses from API calls
  useEffect(() => {
    const handleAuthExpired = async () => {
      console.warn('Auth expired event received - signing out');
      await signOut();
      
      // Show toast notification
      toast.error('Session expired', {
        description: 'Please log in again to continue.',
      });
      
      // Redirect to login if not already there
      if (navigate && location?.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [signOut, navigate, location?.pathname]);

  // Keep userRef in sync with user state
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Reset inactivity timer - using ref to avoid recreating on every render
  const resetInactivityTimer = useRef(() => {
    lastActivityRef.current = Date.now();
    
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    // Only set timer if user is logged in
    if (userRef.current) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log('Auto logout: User inactive for too long');
        supabase.auth.signOut();
      }, INACTIVITY_TIMEOUT);
    }
  });

  // Track user activity
  useEffect(() => {
    if (!user) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ];

    const handleActivity = () => {
      resetInactivityTimer.current();
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start the timer when user logs in
    resetInactivityTimer.current();

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [user]); // Only depend on user, not the callback

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        console.log('Auth state changed:', event);

        switch (event) {
          case 'SIGNED_OUT':
            setSession(null);
            setUser(null);
            if (inactivityTimerRef.current) {
              clearTimeout(inactivityTimerRef.current);
              inactivityTimerRef.current = null;
            }
            break;

          case 'TOKEN_REFRESHED':
            setSession(session);
            setUser(session?.user ?? null);
            // Reset timer on token refresh
            if (session?.user) {
              resetInactivityTimer.current();
            }
            break;

          case 'SIGNED_IN':
            setSession(session);
            setUser(session?.user ?? null);
            // Timer will be started by the activity tracking useEffect
            break;

          default:
            setSession(session);
            setUser(session?.user ?? null);
        }

        setLoading(false);
      }
    );

    // Get initial session and check expiration
    const initializeSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          const handled = await handleSessionError(error);
          if (!handled) {
            console.error('Error retrieving initial session:', error);
          }
          setLoading(false);
          return;
        }

        if (session) {
          const expiresAt = session.expires_at;
          if (expiresAt && expiresAt * 1000 < Date.now()) {
            console.log('Session expired, signing out');
            supabase.auth.signOut();
          } else {
            setSession(session);
            setUser(session.user);
            // Timer will be started by the activity tracking useEffect
          }
        } else {
          setSession(null);
          setUser(null);
        }
      } catch (error) {
        const handled = await handleSessionError(error);
        if (!handled) {
          console.error('Unexpected error retrieving initial session:', error);
        }
      } finally {
        setLoading(false);
      }
    };

    initializeSession();

    // Periodically check session expiration (every 5 minutes)
    const checkSessionExpiration = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          const handled = await handleSessionError(error);
          if (!handled) {
            console.error('Error during periodic session check:', error);
          }
          return;
        }

        if (session) {
          const expiresAt = session.expires_at;
          if (expiresAt && expiresAt * 1000 < Date.now()) {
            console.log('Session expired during periodic check, signing out');
            supabase.auth.signOut();
          }
        }
      } catch (error) {
        const handled = await handleSessionError(error);
        if (!handled) {
          console.error('Unexpected error during periodic session check:', error);
        }
      }
    };

    const expirationCheckInterval = setInterval(() => {
      checkSessionExpiration();
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => {
      subscription.unsubscribe();
      clearInterval(expirationCheckInterval);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [handleSessionError]); // handleSessionError is stable via useCallback

  const value = {
    user,
    session,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};