import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { MARKET_CATALOG, marketSession } from '@/lib/marketSessions';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Globe } from 'lucide-react';

// Both dashboard and sidebar share one clock and one timer while mounted.
let sessionNow = Date.now();
let sessionTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();
const refreshSessionClock = () => {
  sessionNow = Date.now();
  clockListeners.forEach(listener => listener());
};
const subscribeSessionClock = (listener: () => void) => {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    sessionNow = Date.now();
    sessionTimer = setInterval(() => {
      if (!document.hidden) refreshSessionClock();
    }, 30_000);
    window.addEventListener('focus', refreshSessionClock);
    document.addEventListener('visibilitychange', refreshSessionClock);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      clearInterval(sessionTimer);
      sessionTimer = undefined;
      window.removeEventListener('focus', refreshSessionClock);
      document.removeEventListener('visibilitychange', refreshSessionClock);
    }
  };
};
const getSessionClock = () => sessionNow;
const getServerClock = () => 0;

export function SelectedMarkets({ compact = false, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
  const now = useSyncExternalStore(subscribeSessionClock, getSessionClock, getServerClock);
  const { selectedMarkets, loading, error } = useUserPreferences();
  const content = loading ? <p className="text-sm text-muted-foreground">Loading markets…</p>
    : error ? <Link className="text-sm underline" to="/dashboard/settings">Market preferences unavailable · Settings</Link>
    : selectedMarkets.length === 0 ? <Link className="text-sm underline" to="/dashboard/settings">Choose markets in Settings</Link>
    : <div className={compact ? 'max-h-40 space-y-2 overflow-y-auto' : 'flex flex-wrap gap-3'}>
      {MARKET_CATALOG.filter(market => selectedMarkets.includes(market.id)).map(market => {
        const session = marketSession(market.id, new Date(now));
        return <div key={market.id} className="flex items-center gap-2 text-sm" title={`${session.description} Exchange timezone: ${market.timezone}`}>
          <span className="font-medium">{market.name}</span>
          <Badge variant="outline" className="text-xs">{session.label}</Badge>
        </div>;
      })}
    </div>;
  if (collapsed) return <Popover><PopoverTrigger asChild>
    <button type="button" className="mx-auto p-2 rounded hover:bg-sidebar-accent" aria-label="Selected markets"><Globe className="h-4 w-4" /></button>
  </PopoverTrigger><PopoverContent side="right" className="w-80"><p className="font-medium mb-2">Markets · scheduled sessions</p>{content}</PopoverContent></Popover>;
  return <section aria-label="Selected markets" className={compact ? 'p-2' : ''}>{content}</section>;
}
