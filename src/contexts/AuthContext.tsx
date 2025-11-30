import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

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
    supabase.auth.getSession().then(({ data: { session } }) => {
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
      setLoading(false);
    });

    // Periodically check session expiration (every 5 minutes)
    const expirationCheckInterval = setInterval(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          const expiresAt = session.expires_at;
          if (expiresAt && expiresAt * 1000 < Date.now()) {
            console.log('Session expired during periodic check, signing out');
            supabase.auth.signOut();
          }
        }
      });
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => {
      subscription.unsubscribe();
      clearInterval(expirationCheckInterval);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, []); // No dependencies - runs once on mount

  const signOut = async () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Sign out error (will clear local state anyway):', error);
    }
    
    // ALWAYS clear local state, even if server signOut fails
    // This handles the case where session is already expired on server
    setSession(null);
    setUser(null);
    
    // Force clear Supabase localStorage tokens to ensure clean state
    localStorage.removeItem('sb-tiitofotheupylvxivge-auth-token');
  };

  const value = {
    user,
    session,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};