import { useWebSocketStatus, WebSocketStatus } from '@/contexts/ExecutionStoreContext';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

interface WebSocketStatusIndicatorProps {
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<WebSocketStatus, { color: string; icon: React.ReactNode; label: string }> = {
  connected: { 
    color: 'text-emerald-500', 
    icon: <Wifi className="w-3 h-3" />,
    label: 'Connected' 
  },
  connecting: { 
    color: 'text-yellow-500', 
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
    label: 'Connecting...' 
  },
  reconnecting: { 
    color: 'text-amber-500', 
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
    label: 'Reconnecting...' 
  },
  disconnected: { 
    color: 'text-red-500', 
    icon: <WifiOff className="w-3 h-3" />,
    label: 'Disconnected' 
  },
};

export const WebSocketStatusIndicator: React.FC<WebSocketStatusIndicatorProps> = ({ 
  size = 'sm',
  showLabel = false 
}) => {
  const status = useWebSocketStatus();
  const config = STATUS_CONFIG[status];
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1 ${config.color}`}>
            {/* Pulsing dot */}
            <span className={`relative flex ${size === 'md' ? 'h-3 w-3' : 'h-2 w-2'}`}>
              {status === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-full w-full ${
                status === 'connected' ? 'bg-emerald-500' :
                status === 'connecting' || status === 'reconnecting' ? 'bg-yellow-500' :
                'bg-red-500'
              }`} />
            </span>
            {showLabel && <span className="text-xs">{config.label}</span>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          <p>WebSocket: {config.label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
