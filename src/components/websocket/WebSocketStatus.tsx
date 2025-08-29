import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Wifi, WifiOff, Users, Activity, RefreshCw } from 'lucide-react';

export const WebSocketStatus: React.FC = () => {
  const { 
    isConnected, 
    stats, 
    connect, 
    disconnect, 
    ping,
    reconnectAttempts,
    lastMessage 
  } = useWebSocket();

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="h-5 w-5 text-green-500" />
          ) : (
            <WifiOff className="h-5 w-5 text-red-500" />
          )}
          WebSocket Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Connection:</span>
          <Badge variant={isConnected ? "default" : "destructive"}>
            {isConnected ? "Connected" : "Disconnected"}
          </Badge>
        </div>

        {reconnectAttempts > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Reconnect attempts:</span>
            <Badge variant="outline">{reconnectAttempts}/5</Badge>
          </div>
        )}

        {stats && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Users className="h-4 w-4" />
                Total Clients:
              </span>
              <Badge variant="outline">{stats.totalClients}</Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Activity className="h-4 w-4" />
                Connected Users:
              </span>
              <Badge variant="outline">{stats.connectedUsers}</Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Sessions:</span>
              <Badge variant="outline">{stats.activeSessions}</Badge>
            </div>
          </>
        )}

        {lastMessage && (
          <div className="border-t pt-3">
            <span className="text-sm text-muted-foreground">Last message:</span>
            <div className="mt-1 p-2 bg-muted rounded text-xs font-mono">
              <div><strong>Type:</strong> {lastMessage.type}</div>
              {lastMessage.timestamp && (
                <div><strong>Time:</strong> {new Date(lastMessage.timestamp).toLocaleTimeString()}</div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {isConnected ? (
            <>
              <Button 
                onClick={disconnect} 
                variant="outline" 
                size="sm"
                className="flex-1"
              >
                Disconnect
              </Button>
              <Button 
                onClick={ping} 
                variant="outline" 
                size="sm"
                className="flex items-center gap-1"
              >
                <RefreshCw className="h-4 w-4" />
                Ping
              </Button>
            </>
          ) : (
            <Button 
              onClick={connect} 
              size="sm"
              className="flex-1"
            >
              Connect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};