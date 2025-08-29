import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WebSocketStatus } from '@/components/websocket/WebSocketStatus';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function WebSocketTest() {
  const { 
    isConnected, 
    sendMessage, 
    subscribeToWorkflow,
    subscribeToBroker,
    requestAlpacaStream,
    lastMessage 
  } = useWebSocket();

  const [customMessage, setCustomMessage] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [brokerName, setBrokerName] = useState('alpaca');
  const [symbols, setSymbols] = useState('AAPL,GOOGL,TSLA');
  const [messages, setMessages] = useState<any[]>([]);

  // Store all messages for display
  React.useEffect(() => {
    if (lastMessage) {
      setMessages(prev => [...prev.slice(-19), lastMessage]); // Keep last 20 messages
    }
  }, [lastMessage]);

  const handleSendCustomMessage = () => {
    if (!customMessage.trim()) return;
    
    try {
      const messageObj = JSON.parse(customMessage);
      sendMessage(messageObj);
      setCustomMessage('');
    } catch (error) {
      // If not valid JSON, send as text message
      sendMessage({ 
        type: 'custom_message', 
        payload: { text: customMessage } 
      });
      setCustomMessage('');
    }
  };

  const handleSubscribeWorkflow = () => {
    if (!workflowId.trim()) return;
    subscribeToWorkflow(workflowId);
    setWorkflowId('');
  };

  const handleSubscribeBroker = () => {
    subscribeToBroker(brokerName);
  };

  const handleRequestAlpacaStream = () => {
    const symbolArray = symbols.split(',').map(s => s.trim()).filter(s => s);
    requestAlpacaStream(symbolArray);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">WebSocket Test</h1>
        <Badge variant={isConnected ? "default" : "destructive"}>
          {isConnected ? "Connected" : "Disconnected"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Panel */}
        <div className="space-y-6">
          <WebSocketStatus />

          {/* Message History */}
          <Card>
            <CardHeader>
              <CardTitle>Message History</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 w-full">
                <div className="space-y-2">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No messages yet...</p>
                  ) : (
                    messages.map((msg, index) => (
                      <div key={index} className="border-l-2 border-primary/20 pl-3 py-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {msg.type}
                          </Badge>
                          {msg.timestamp && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        {msg.payload && (
                          <pre className="text-xs mt-1 text-muted-foreground">
                            {JSON.stringify(msg.payload, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Test Controls */}
        <div className="space-y-6">
          <Tabs defaultValue="custom" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="custom">Custom</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
              <TabsTrigger value="broker">Broker</TabsTrigger>
              <TabsTrigger value="alpaca">Alpaca</TabsTrigger>
            </TabsList>

            <TabsContent value="custom" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Send Custom Message</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="custom-message">Message (JSON or text)</Label>
                    <Textarea
                      id="custom-message"
                      placeholder='{"type": "ping"} or just plain text'
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <Button 
                    onClick={handleSendCustomMessage}
                    disabled={!isConnected || !customMessage.trim()}
                    className="w-full"
                  >
                    Send Message
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="workflow" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Workflow Subscription</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="workflow-id">Workflow ID</Label>
                    <Input
                      id="workflow-id"
                      placeholder="Enter workflow ID"
                      value={workflowId}
                      onChange={(e) => setWorkflowId(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleSubscribeWorkflow}
                    disabled={!isConnected || !workflowId.trim()}
                    className="w-full"
                  >
                    Subscribe to Workflow
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="broker" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Broker Subscription</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="broker-name">Broker Name</Label>
                    <Input
                      id="broker-name"
                      placeholder="alpaca, dhan, etc."
                      value={brokerName}
                      onChange={(e) => setBrokerName(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleSubscribeBroker}
                    disabled={!isConnected || !brokerName.trim()}
                    className="w-full"
                  >
                    Subscribe to Broker Events
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="alpaca" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Alpaca Real-time Stream</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="symbols">Symbols (comma-separated)</Label>
                    <Input
                      id="symbols"
                      placeholder="AAPL,GOOGL,TSLA"
                      value={symbols}
                      onChange={(e) => setSymbols(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={handleRequestAlpacaStream}
                    disabled={!isConnected || !symbols.trim()}
                    className="w-full"
                  >
                    Start Alpaca Stream
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}