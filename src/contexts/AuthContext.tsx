/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/lib/apiClient';

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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userRef = useRef<User | null>(null);

  const clearLocalSessionState = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    setSession(null);
    setUser(null);

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

  // Session expiry listener intentionally disabled for testing.
  // Keeping previous implementation in comments for easy re-enable.
  // useEffect(() => {
  //   const handleAuthExpired = async () => {
  //     console.warn('Auth expired event received - signing out');
  //     await signOut();
  //
  //     toast.error('Session expired', {
  //       description: 'Please log in again to continue.',
  //     });
  //
  //     if (navigate && location?.pathname !== '/login') {
  //       navigate('/login', { replace: true });
  //     }
  //   };
  //
  //   window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  //
  //   return () => {
  //     window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  //   };
  // }, [signOut, navigate, location?.pathname]);

  // Keep userRef in sync with user state
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Ref to hold signOut function for use in the disabled expiry paths.
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  // Inactivity auto-logout intentionally disabled for testing.
  // Keeping previous implementation in comments for easy re-enable.
  // const resetInactivityTimer = useRef(() => {
  //   lastActivityRef.current = Date.now();
  //
  //   if (inactivityTimerRef.current) {
  //     clearTimeout(inactivityTimerRef.current);
  //     inactivityTimerRef.current = null;
  //   }
  //
  //   if (userRef.current) {
  //     inactivityTimerRef.current = setTimeout(async () => {
  //       console.log('Auto logout: User inactive for too long');
  //       await signOutRef.current();
  //     }, INACTIVITY_TIMEOUT);
  //   }
  // });

  // useEffect(() => {
  //   if (!user) {
  //     if (inactivityTimerRef.current) {
  //       clearTimeout(inactivityTimerRef.current);
  //       inactivityTimerRef.current = null;
  //     }
  //     return;
  //   }
  //
  //   const activityEvents = [
  //     'mousedown',
  //     'mousemove',
  //     'keypress',
  //     'scroll',
  //     'touchstart',
  //     'click',
  //   ];
  //
  //   const handleActivity = () => {
  //     resetInactivityTimer.current();
  //   };
  //
  //   activityEvents.forEach((event) => {
  //     window.addEventListener(event, handleActivity, { passive: true });
  //   });
  //
  //   resetInactivityTimer.current();
  //
  //   return () => {
  //     activityEvents.forEach((event) => {
  //       window.removeEventListener(event, handleActivity);
  //     });
  //     if (inactivityTimerRef.current) {
  //       clearTimeout(inactivityTimerRef.current);
  //       inactivityTimerRef.current = null;
  //     }
  //   };
  // }, [user]);

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
            // Inactivity timer reset disabled for testing.
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
          // Session expiry check intentionally disabled for testing.
          // const expiresAt = session.expires_at;
          // if (expiresAt && expiresAt * 1000 < Date.now()) {
          //   console.log('Session expired, signing out');
          //   await signOutRef.current();
          // } else {
          //   setSession(session);
          //   setUser(session.user);
          // }
          setSession(session);
          setUser(session.user);
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

    // Periodic session expiry checks intentionally disabled for testing.
    // const checkSessionExpiration = async () => {
    //   try {
    //     const { data: { session }, error } = await supabase.auth.getSession();
    //
    //     if (error) {
    //       const handled = await handleSessionError(error);
    //       if (!handled) {
    //         console.error('Error during periodic session check:', error);
    //       }
    //       return;
    //     }
    //
    //     if (session) {
    //       const expiresAt = session.expires_at;
    //       if (expiresAt && expiresAt * 1000 < Date.now()) {
    //         console.log('Session expired during periodic check, signing out');
    //         await signOutRef.current();
    //       }
    //     }
    //   } catch (error) {
    //     const handled = await handleSessionError(error);
    //     if (!handled) {
    //       console.error('Unexpected error during periodic session check:', error);
    //     }
    //   }
    // };
    //
    // const expirationCheckInterval = setInterval(() => {
    //   checkSessionExpiration();
    // }, 5 * 60 * 1000);

    return () => {
      subscription.unsubscribe();
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
