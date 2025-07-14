import React from 'react';
import { Handle, Position } from '@xyflow/react';

interface NodeWrapperProps {
  children: React.ReactNode;
  nodeId?: string;
  selected?: boolean;
  label: string;
  minWidth?: number;
  minHeight?: number;
  handles?: Array<{ type: string; position: string; id: string }>;
  nodeType?: string;
  icon?: React.ReactNode;
  inputPanelProps?: any;
  outputPanelProps?: any;
  nodes?: any[];
  edges?: any[];
}

const NodeWrapper: React.FC<NodeWrapperProps> = ({
  children,
  selected,
  label,
  minWidth = 340,
  minHeight = 340,
  handles = [],
  icon,
}) => {
  const positionMap: Record<string, Position> = {
    top: Position.Top,
    bottom: Position.Bottom,
    left: Position.Left,
    right: Position.Right,
  };

  return (
    <div 
      className={`
        bg-card border-2 rounded-lg p-4 shadow-card
        transition-all duration-200
        ${selected ? 'border-primary shadow-glow' : 'border-border'}
        hover:border-muted-foreground
      `}
      style={{ minWidth, minHeight }}
    >
      <div className="flex items-center gap-2 mb-3">
        {icon && (
          <div className="p-1.5 rounded-md bg-muted/50 flex items-center justify-center">
            {icon}
          </div>
        )}
        <span className="text-sm font-medium text-foreground truncate">{label}</span>
      </div>
      
      {children}
      
      {/* Render handles */}
      {handles.map((handle, index) => (
        <Handle
          key={handle.id || index}
          type={handle.type as 'source' | 'target'}
          position={positionMap[handle.position] || Position.Left}
          id={handle.id}
          className="w-3 h-3 border-2 border-border bg-background hover:border-primary transition-colors"
        />
      ))}
    </div>
  );
};

export default NodeWrapper;