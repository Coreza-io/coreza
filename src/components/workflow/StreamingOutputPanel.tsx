import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X, Wifi, WifiOff, Activity } from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";

export type StreamingOutputPanelProps = {
  nodeId?: string;
  data: any;
  isExpanded: boolean;
  position?: "left" | "right";
  pinned?: boolean;
  onSave?: (data: any) => void;
  onPinToggle?: () => void;
  isStreamingNode?: boolean;
};

// Real-time data display component
const StreamDataDisplay: React.FC<{ data: any[] }> = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic text-center py-4">
        Waiting for stream data...
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-96 overflow-y-auto">
      {data.slice(-20).map((item, index) => (
        <div
          key={index}
          className="flex flex-col p-2 rounded-md bg-muted/20 border border-border/30 text-xs"
        >
          {typeof item === 'object' ? (
            Object.entries(item).map(([key, value]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="font-semibold text-primary">{key}:</span>
                <span className="text-foreground font-mono">
                  {typeof value === 'number' ? value.toFixed(4) : String(value)}
                </span>
              </div>
            ))
          ) : (
            <span className="text-foreground">{String(item)}</span>
          )}
        </div>
      ))}
    </div>
  );
};

// Static data renderer (reused from OutputPanel)
const renderStaticData = (data: any): React.ReactNode => {
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return (
      <div className="text-sm text-muted-foreground italic text-center py-6">
        No output yet.
      </div>
    );
  }
  
  if (typeof data === "object" && data !== null) {
    return (
      <div className="flex flex-col gap-2">
        {Object.entries(data).map(([key, value]) => (
          <div
            key={key}
            className="flex flex-col px-3 py-2 rounded-md bg-background hover:bg-muted/50 transition-colors border border-border/30"
          >
            <span className="text-xs font-semibold text-primary">{key}</span>
            <span className="text-xs text-foreground pl-2 mt-1">
              {value === undefined ? (
                <span className="text-muted-foreground">undefined</span>
              ) : value === null ? (
                <span className="text-muted-foreground">null</span>
              ) : typeof value === "object" ? (
                <span className="font-mono text-muted-foreground bg-muted/20 px-2 py-1 rounded text-xs">
                  {JSON.stringify(value, null, 2)}
                </span>
              ) : (
                <span className="break-words">{String(value)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-2 p-3 bg-background rounded-md border border-border/30">
      <span className="text-xs font-semibold text-primary">value:</span>
      <span className="text-xs text-foreground break-words">{String(data)}</span>
    </div>
  );
};

const StreamingOutputPanel: React.FC<StreamingOutputPanelProps> = ({
  nodeId,
  data = {},
  isExpanded,
  position = "right",
  pinned = false,
  onSave = () => {},
  onPinToggle = () => {},
  isStreamingNode = false,
}) => {
  const [internalData, setInternalData] = useState<any>(data);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [streamData, setStreamData] = useState<any[]>([]);
  const [showStream, setShowStream] = useState(isStreamingNode);

  const { 
    isConnected, 
    connectionStatus, 
    subscribeToMessages,
    lastMessage 
  } = useWebSocket();

  // Subscribe to stream data for this node
  useEffect(() => {
    if (!isStreamingNode || !nodeId) return;

    const unsubscribe = subscribeToMessages('stream_data', (payload) => {
      // Filter messages for this specific node
      if (payload.nodeId === nodeId || payload.node_id === nodeId) {
        setStreamData(prev => [...prev, payload.data]);
      }
    });

    // Also listen for Alpaca-specific stream data
    const unsubscribeAlpaca = subscribeToMessages('alpaca_data', (payload) => {
      if (payload.nodeId === nodeId || payload.node_id === nodeId) {
        setStreamData(prev => [...prev, payload]);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeAlpaca();
    };
  }, [isStreamingNode, nodeId, subscribeToMessages]);

  // Sync internal state when upstream data changes, unless pinned
  useEffect(() => {
    if (!pinned) {
      setInternalData(data);
      setIsEditing(false);
    }
  }, [data, pinned]);

  if (!isExpanded) return null;

  // Connection status indicator
  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="w-3 h-3 text-success" />;
      case 'connecting':
        return <Activity className="w-3 h-3 text-warning animate-pulse" />;
      default:
        return <WifiOff className="w-3 h-3 text-muted-foreground" />;
    }
  };

  const getConnectionBadge = () => {
    const variant = isConnected ? 'default' : 'secondary';
    const text = isConnected ? 'Live' : 'Offline';
    return (
      <Badge variant={variant} className="text-xs h-5">
        {getConnectionIcon()}
        <span className="ml-1">{text}</span>
      </Badge>
    );
  };

  // Handlers
  const handleEdit = () => {
    setEditText(JSON.stringify(internalData, null, 2));
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editText);
      setInternalData(parsed);
      if (typeof onSave === "function") {
        onSave(parsed);
      }
      setIsEditing(false);
    } catch (error) {
      console.error("Invalid JSON:", error);
    }
  };

  const handleCancel = () => {
    setEditText("");
    setIsEditing(false);
  };

  const toggleStreamView = () => {
    setShowStream(!showStream);
  };

  return (
    <div
      className={`absolute ${
        position === "right"
          ? "left-full top-0 ml-2"
          : "right-full top-0 mr-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground text-sm tracking-tight">
            Output Data
          </span>
          {isStreamingNode && getConnectionBadge()}
        </div>
        <div className="flex items-center space-x-1">
          {isStreamingNode && (
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 w-7 p-0 transition-colors ${
                showStream 
                  ? "text-primary hover:text-primary-glow" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={toggleStreamView}
              title={showStream ? "Show Static Data" : "Show Stream Data"}
            >
              <Activity className="w-3 h-3" />
            </Button>
          )}
          {!isEditing && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground hover:bg-muted h-7 w-7 p-0"
              onClick={handleEdit}
              title="Edit Output"
            >
              <Edit2 className="w-3 h-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={`hover:bg-muted h-7 w-7 p-0 transition-colors ${
              pinned 
                ? "text-primary hover:text-primary-glow" 
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={onPinToggle}
            title={pinned ? "Unpin Output" : "Pin Output"}
          >
            {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
          </Button>
        </div>
      </div>
      
      <div className="p-3 h-[calc(100%-42px)] overflow-auto">
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              className="w-full p-3 border border-border rounded-md font-mono text-xs bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
              rows={12}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Enter JSON data..."
            />
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCancel}
                className="h-7 px-3 text-xs"
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button 
                size="sm" 
                onClick={handleSave}
                className="h-7 px-3 text-xs bg-success hover:bg-success/90 text-success-foreground"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {isStreamingNode && showStream ? (
              <StreamDataDisplay data={streamData} />
            ) : (
              renderStaticData(internalData)
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StreamingOutputPanel;