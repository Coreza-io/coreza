import { useMarketBenchmarks, benchmarkChange } from '@/hooks/useMarketBenchmarks';
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { MARKET_CATALOG, marketSession, type SessionPhase } from '@/lib/marketSessions';
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

const phaseColors: Record<SessionPhase, string> = {
  regular: 'border-green-500/50 text-green-700 dark:text-green-400',
  preopen: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  premarket: 'border-blue-500/50 text-blue-700 dark:text-blue-300',
  afterhours: 'border-purple-500/50 text-purple-700 dark:text-purple-300',
  overnight: 'border-indigo-500/50 text-indigo-700 dark:text-indigo-300',
  closed: 'text-muted-foreground', unknown: 'border-amber-500/50 text-muted-foreground',
  always: 'text-muted-foreground',
};

export function SelectedMarkets({ compact = false, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
  const quotes = useMarketBenchmarks();
  const now = useSyncExternalStore(subscribeSessionClock, getSessionClock, getServerClock);
  const { selectedMarkets, loading, error } = useUserPreferences();
  const content = loading ? <p className="text-sm text-muted-foreground">Loading markets…</p>
    : error ? <Link className="text-sm underline" to="/dashboard/settings">Market preferences unavailable · Settings</Link>
    : selectedMarkets.length === 0 ? <Link className="text-sm underline" to="/dashboard/settings">Choose markets in Settings</Link>
    : <div className={compact ? 'max-h-40 space-y-2 overflow-y-auto' : 'flex flex-wrap gap-3'}>
      {MARKET_CATALOG.filter(market => selectedMarkets.includes(market.id)).map(market => {
        const session = marketSession(market.id, new Date(now));
        const quote = quotes.data?.find(row => row.market === market.id);
        const changeText = quotes.isError ? 'Quote unavailable' : quote ? benchmarkChange(quote) : quotes.isPending ? 'Loading quote…' : 'Quote unavailable';
        return <div key={market.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{market.name}</span>
          <span className={`text-xs tabular-nums ${!quotes.isError && quote?.available && Number.isFinite(quote.change) ? quote.change! > 0 ? 'text-green-700 dark:text-green-400' : quote.change! < 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground' : 'text-muted-foreground'}`}>
            {changeText}
          </span>
          <Popover><PopoverTrigger asChild>
            <button type="button" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${market.name}: ${session.label}. Session details`}>
              <Badge variant="outline" className={`text-xs ${phaseColors[session.phase]}`}>{session.label}</Badge>
            </button>
          </PopoverTrigger><PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-2 text-sm">
            <p className="font-medium">{market.name} · {session.label}</p>
            <p>{session.description}</p>
            {quote && <div className="space-y-1 text-xs">
              <p>Benchmark: {quote.name} ({quote.symbol})</p>
              <p>Source: {quote.source} · {quote.period ?? 'Unavailable'}</p>
              {quote.asOf && <p>Quote as of (UTC): {quote.asOf}</p>}
              <p>The change is against the provider’s previous daily close/reference. It is not a pre-market or ATS quote. Provider data may be delayed.</p>
            </div>}
            <p className="text-xs text-muted-foreground">Timezone: {session.timezone}{session.tradeDate ? ` · Trade date: ${session.tradeDate}` : ''}</p>
            {session.coverage && <p className="text-xs text-muted-foreground">Calendar: {session.coverage.from}–{session.coverage.through} · version {session.coverage.version}</p>}
            <p className="text-xs text-muted-foreground">Scheduled sessions only; not live exchange status or account eligibility.</p>
            {session.sources.length > 0 && <ul className="space-y-1">{session.sources.map(url => <li key={url}><a className="text-xs underline" href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></li>)}</ul>}
          </PopoverContent></Popover>
          {session.phase === 'overnight' && <span className="w-full text-xs text-muted-foreground">Exchange closed · Blue Ocean schedule</span>}
          {session.extendedCoverage === 'unavailable' && <span className="w-full text-xs text-muted-foreground">Extended schedule unavailable</span>}
        </div>;
      })}
    </div>;
  if (collapsed) return <Popover><PopoverTrigger asChild>
    <button type="button" className="mx-auto p-2 rounded hover:bg-sidebar-accent" aria-label="Selected markets"><Globe className="h-4 w-4" /></button>
  </PopoverTrigger><PopoverContent side="right" className="w-80"><p className="font-medium mb-2">Scheduled market sessions</p>{content}</PopoverContent></Popover>;
  return <section aria-label="Selected markets" className={compact ? 'p-2' : ''}>
    <p className="mb-2 text-xs text-muted-foreground">Scheduled market sessions</p>{content}
  </section>;
}
