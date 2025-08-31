import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useWebSocket } from '@/hooks/useWebSocket';
import { WebSocketStatus } from '@/components/websocket/WebSocketStatus';
import { Play, Square, Activity } from 'lucide-react';

export default function StreamTest() {
  const [symbols, setSymbols] = useState('AAPL,MSFT');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamData, setStreamData] = useState<any[]>([]);
  const [lastMessage, setLastMessage] = useState<any>(null);

  const {
    isConnected,
    connectionStatus,
    sendMessage,
    subscribeToMessages,
    subscribeToAlpacaStream,
    unsubscribeFromAlpacaStream,
    lastMessage: wsLastMessage,
  } = useWebSocket();

  // Subscribe to all WebSocket messages for debugging
  useEffect(() => {
    const unsubscribe = subscribeToMessages('alpaca_data', (payload) => {
      console.log('📈 Received Alpaca data:', payload);
      setStreamData(prev => [...prev.slice(-19), payload]);
    });

    const unsubscribeResponse = subscribeToMessages('alpaca_response', (payload) => {
      console.log('✅ Alpaca response:', payload);
      setLastMessage(payload);
    });

    const unsubscribeError = subscribeToMessages('alpaca_error', (payload) => {
      console.error('❌ Alpaca error:', payload);
      setLastMessage(payload);
    });

    return () => {
      unsubscribe();
      unsubscribeResponse();
      unsubscribeError();
    };
  }, [subscribeToMessages]);

  const handleStartStream = () => {
    if (!symbols.trim()) return;
    
    const symbolArray = symbols.split(',').map(s => s.trim().toUpperCase());
    subscribeToAlpacaStream(symbolArray, 'test-credential-id');
    setIsStreaming(true);
    setStreamData([]);
  };

  const handleStopStream = () => {
    if (!symbols.trim()) return;
    
    const symbolArray = symbols.split(',').map(s => s.trim().toUpperCase());
    unsubscribeFromAlpacaStream(symbolArray);
    setIsStreaming(false);
  };

  const handleTestMessage = () => {
    sendMessage({
      type: 'ping',
      payload: { test: 'Hello from test page' }
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">WebSocket Stream Test</h1>
        <WebSocketStatus showText={true} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Connection Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm">Status:</span>
              <Badge variant={isConnected ? 'default' : 'secondary'}>
                {connectionStatus}
              </Badge>
            </div>
            
            <div className="space-y-2">
              <Button 
                onClick={handleTestMessage}
                disabled={!isConnected}
                variant="outline"
                size="sm"
              >
                Send Test Ping
              </Button>
              
              {wsLastMessage && (
                <div className="text-xs bg-muted p-2 rounded font-mono">
                  <strong>Last Message:</strong>
                  <pre>{JSON.stringify(wsLastMessage, null, 2)}</pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alpaca Stream Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📈 Alpaca Stream Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Symbols</label>
              <Input
                value={symbols}
                onChange={(e) => setSymbols(e.target.value)}
                placeholder="AAPL,MSFT,GOOGL"
                disabled={isStreaming}
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleStartStream}
                disabled={!isConnected || isStreaming || !symbols.trim()}
                size="sm"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Stream
              </Button>
              
              <Button
                onClick={handleStopStream}
                disabled={!isConnected || !isStreaming}
                variant="outline"
                size="sm"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop Stream
              </Button>
            </div>

            {lastMessage && (
              <div className="text-xs bg-muted p-2 rounded">
                <strong>Response:</strong> {JSON.stringify(lastMessage, null, 2)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stream Data Display */}
      {streamData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Live Stream Data</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {streamData.map((item, index) => (
                <div
                  key={index}
                  className="p-2 bg-muted/20 rounded text-sm font-mono border"
                >
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>#{index + 1}</span>
                    <span>{new Date().toLocaleTimeString()}</span>
                  </div>
                  <pre className="mt-1">{JSON.stringify(item, null, 2)}</pre>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Debug Info */}
      <Card>
        <CardHeader>
          <CardTitle>Debug Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div>Connected: {isConnected ? '✅' : '❌'}</div>
            <div>Status: {connectionStatus}</div>
            <div>Streaming: {isStreaming ? '✅' : '❌'}</div>
            <div>Data Points: {streamData.length}</div>
            <div>Current Symbols: {symbols}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}