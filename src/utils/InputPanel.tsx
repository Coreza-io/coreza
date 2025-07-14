import React from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronUp } from "lucide-react";

interface InputPanelProps {
  nodeId?: string;
  nodes?: any[];
  edges?: any[];
  isExpanded?: boolean;
  handleDragStart?: (e: React.DragEvent, keyPath: string, value: string) => void;
  selectedPrevNodeId?: string;
  setSelectedPrevNodeId?: (id: string) => void;
}

const InputPanel: React.FC<InputPanelProps> = ({
  nodeId,
  nodes = [],
  edges = [],
  isExpanded = true,
  handleDragStart,
  selectedPrevNodeId,
  setSelectedPrevNodeId,
}) => {
  // Get upstream nodes
  const upstreamNodes = edges
    .filter(e => e.target === nodeId)
    .map(e => nodes.find(n => n.id === e.source))
    .filter(Boolean);

  if (!isExpanded || upstreamNodes.length === 0) {
    return null;
  }

  const selectedNode = upstreamNodes.find(n => n.id === selectedPrevNodeId) || upstreamNodes[0];
  const data = selectedNode?.data?.output || selectedNode?.data || {};

  const renderDataTree = (obj: any, path = ''): React.ReactNode => {
    if (obj === null || obj === undefined) {
      return <span className="text-muted-foreground">null</span>;
    }

    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return (
        <span
          className="cursor-grab text-primary hover:text-primary-glow"
          draggable={handleDragStart ? true : false}
          onDragStart={handleDragStart ? (e) => handleDragStart(e, path, String(obj)) : undefined}
        >
          {String(obj)}
        </span>
      );
    }

    if (Array.isArray(obj)) {
      return (
        <div className="space-y-1">
          {obj.slice(0, 5).map((item, idx) => (
            <div key={idx} className="ml-4">
              <span className="text-muted-foreground">[{idx}]:</span>{' '}
              {renderDataTree(item, `${path}[${idx}]`)}
            </div>
          ))}
          {obj.length > 5 && (
            <div className="ml-4 text-muted-foreground text-xs">
              ... and {obj.length - 5} more items
            </div>
          )}
        </div>
      );
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj).slice(0, 10);
      return (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="ml-4">
              <span className="text-muted-foreground">{key}:</span>{' '}
              {renderDataTree(value, path ? `${path}.${key}` : key)}
            </div>
          ))}
          {Object.keys(obj).length > 10 && (
            <div className="ml-4 text-muted-foreground text-xs">
              ... and {Object.keys(obj).length - 10} more properties
            </div>
          )}
        </div>
      );
    }

    return <span className="text-muted-foreground">{String(obj)}</span>;
  };

  return (
    <Card className="absolute left-[-320px] top-0 w-80 bg-card border border-border shadow-card z-10">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Input Data</span>
        </div>
        
        {upstreamNodes.length > 1 && (
          <select
            value={selectedPrevNodeId || upstreamNodes[0]?.id || ''}
            onChange={(e) => setSelectedPrevNodeId?.(e.target.value)}
            className="w-full p-2 mb-3 text-sm bg-background border border-border rounded"
          >
            {upstreamNodes.map(node => (
              <option key={node.id} value={node.id}>
                {node.data?.definition?.name || node.type || `Node ${node.id}`}
              </option>
            ))}
          </select>
        )}

        <div className="max-h-64 overflow-auto text-xs">
          {Object.keys(data).length > 0 ? (
            renderDataTree(data)
          ) : (
            <div className="text-muted-foreground text-center py-4">
              No data available
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default InputPanel;