import { Link } from 'react-router-dom';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { MARKET_CATALOG, marketSession } from '@/lib/marketSessions';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Globe } from 'lucide-react';

export function SelectedMarkets({ compact = false, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
  const { selectedMarkets, loading, error } = useUserPreferences();
  const content = loading ? <p className="text-sm text-muted-foreground">Loading markets…</p>
    : error ? <Link className="text-sm underline" to="/dashboard/settings">Market preferences unavailable · Settings</Link>
    : selectedMarkets.length === 0 ? <Link className="text-sm underline" to="/dashboard/settings">Choose markets in Settings</Link>
    : <div className={compact ? 'max-h-40 space-y-2 overflow-y-auto' : 'flex flex-wrap gap-3'}>
      {MARKET_CATALOG.filter(market => selectedMarkets.includes(market.id)).map(market => {
        const session = marketSession(market.id);
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
