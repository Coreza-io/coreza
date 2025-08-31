import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Activity, AlertCircle } from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';

interface WebSocketStatusProps {
  className?: string;
  showText?: boolean;
}

export const WebSocketStatus: React.FC<WebSocketStatusProps> = ({ 
  className = '', 
  showText = true 
}) => {
  const { isConnected, connectionStatus, error } = useWebSocket();

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="w-3 h-3" />;
      case 'connecting':
        return <Activity className="w-3 h-3 animate-pulse" />;
      case 'error':
        return <AlertCircle className="w-3 h-3" />;
      default:
        return <WifiOff className="w-3 h-3" />;
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-success text-success-foreground';
      case 'connecting':
        return 'bg-warning text-warning-foreground';
      case 'error':
        return 'bg-destructive text-destructive-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Offline';
    }
  };

  return (
    <Badge 
      className={`${getStatusColor()} ${className}`}
      title={error || getStatusText()}
    >
      {getStatusIcon()}
      {showText && (
        <span className="ml-1 text-xs">
          {getStatusText()}
        </span>
      )}
    </Badge>
  );
};

export default WebSocketStatus;