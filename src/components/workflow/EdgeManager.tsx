import React from 'react';
import { EdgeProps, getSmoothStepPath, MarkerType } from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';

export interface EdgeControl {
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}

export interface SelfLoopConfig {
  offsetX?: number;
  offsetY?: number;
  direction?: 'top' | 'right' | 'bottom' | 'left';
}

export interface InteractiveEdgeProps extends EdgeProps {
  controls?: EdgeControl[];
  selfLoopConfig?: SelfLoopConfig;
}

export const InteractiveEdge: React.FC<InteractiveEdgeProps> = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  controls = [],
  selfLoopConfig,
}) => {
  // Detect self-loop (when source connects to target on same node)
  const isSelfLoop = source === target;
  
  // Default self-loop configuration
  const defaultSelfLoopConfig: SelfLoopConfig = {
    offsetX: 40,
    offsetY: 80,
    direction: 'right'
  };
  
  const loopConfig = { ...defaultSelfLoopConfig, ...selfLoopConfig };
  
  let pathD: string;
  let midX: number;
  let midY: number;
  if (isSelfLoop) {
    // Create self-loop path based on direction
    const { offsetX = 40, offsetY = 80, direction = 'right' } = loopConfig;
    
    switch (direction) {
      case 'top':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `C ${sourceX},${sourceY - offsetY/2} ${sourceX + offsetX/2},${sourceY - offsetY} ${sourceX + offsetX},${sourceY - offsetY}`,
          `C ${sourceX + offsetX + offsetX/2},${sourceY - offsetY} ${targetX + offsetX},${targetY - offsetY/2} ${targetX},${targetY}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY - offsetY;
        break;
      case 'bottom':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `C ${sourceX},${sourceY + offsetY/2} ${sourceX + offsetX/2},${sourceY + offsetY} ${sourceX + offsetX},${sourceY + offsetY}`,
          `C ${sourceX + offsetX + offsetX/2},${sourceY + offsetY} ${targetX + offsetX},${targetY + offsetY/2} ${targetX},${targetY}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY + offsetY;
        break;
      case 'left':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `C ${sourceX - offsetX/2},${sourceY} ${sourceX - offsetX},${sourceY + offsetY/2} ${sourceX - offsetX},${sourceY + offsetY}`,
          `C ${sourceX - offsetX},${sourceY + offsetY + offsetY/2} ${targetX - offsetX/2},${targetY + offsetY} ${targetX},${targetY}`,
        ].join(' ');
        midX = sourceX - offsetX;
        midY = sourceY + offsetY / 2;
        break;
      case 'right':
      default:
        pathD = [
          `M ${sourceX},${sourceY}`,
          `C ${sourceX + offsetX/2},${sourceY} ${sourceX + offsetX},${sourceY + offsetY/2} ${sourceX + offsetX},${sourceY + offsetY}`,
          `C ${sourceX + offsetX},${sourceY + offsetY + offsetY/2} ${targetX + offsetX/2},${targetY + offsetY} ${targetX},${targetY}`,
        ].join(' ');
        midX = sourceX + offsetX;
        midY = sourceY + offsetY / 2;
        break;
    }
  } else {
    // Regular edge path with smooth curves
    pathD = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
    midX = (sourceX + targetX) / 2;
    midY = (sourceY + targetY) / 2;
  }

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={pathD}
        style={{
          ...style,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: controls.length ? 'none' : undefined,
        }}
        markerEnd={markerEnd}
      />
      {data?.label && (
        <text className="react-flow__edge-text">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      {controls.length > 0 && (
        <foreignObject
          x={midX - 40}
          y={midY - 16}
          width={80}
          height={32}
          style={{ pointerEvents: 'all' }}
        >
          <div
            style={{ 
              display: 'flex', 
              gap: '8px', 
              justifyContent: 'center', 
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '16px',
              padding: '4px 8px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
              border: '1px solid rgba(0, 0, 0, 0.1)'
            }}
          >
            {controls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '50%',
                  width: '24px',
                  height: '24px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {ctrl.icon}
              </button>
            ))}
          </div>
        </foreignObject>
      )}
    </>
  );
};

// Generic Self-Loop Edge for any node
export const SelfLoopEdge: React.FC<EdgeProps> = (props) => {
  const { data, selected, source, target } = props;
  
  // Only apply self-loop styling if it's actually a self-loop
  if (source !== target) {
    return <DefaultEdge {...props} />;
  }

  const controls = selected
    ? [
        { icon: <Plus size={16} color="#22c55e" />, onClick: data?.onAddNode as (e: React.MouseEvent) => void },
        { icon: <Trash2 size={16} color="#ef4444" />, onClick: data?.onRemoveEdge as (e: React.MouseEvent) => void },
      ]
    : [];

  return (
    <InteractiveEdge
      {...props}
      selfLoopConfig={{
        offsetX: (data?.offsetX as number) || 40,
        offsetY: (data?.offsetY as number) || 80,
        direction: (data?.direction as 'top' | 'right' | 'bottom' | 'left') || 'right'
      }}
      style={{ stroke: (data?.loopColor as string) || '#6366f1', strokeWidth: 2, strokeDasharray: '5,5' }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

// Default edge for regular connections
export const DefaultEdge: React.FC<EdgeProps> = (props) => {
  const { data, selected } = props;
  const controls = selected
    ? [
        { icon: <Plus size={16} color="#22c55e" />, onClick: data?.onAddNode as (e: React.MouseEvent) => void },
        { icon: <Trash2 size={16} color="#ef4444" />, onClick: data?.onRemoveEdge as (e: React.MouseEvent) => void },
      ]
    : [];

  return (
    <InteractiveEdge
      {...props}
      style={{ stroke: '#888', strokeWidth: 2 }}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

// Keep LoopEdge for backward compatibility with existing Loop nodes
export const LoopEdge: React.FC<EdgeProps> = (props) => {
  const { data, selected } = props;
  const controls = selected
    ? [
        { icon: <Plus size={12} color="#22c55e" />, onClick: data?.onAddLoop as (e: React.MouseEvent) => void },
        { icon: <Trash2 size={12} color="#e11d48" />, onClick: data?.onRemoveLoop as (e: React.MouseEvent) => void },
      ]
    : [];

  return (
    <InteractiveEdge
      {...props}
      selfLoopConfig={{ offsetX: 20, offsetY: 80, direction: 'right' }}
      style={{ stroke: '#22c55e', strokeWidth: 3 }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

const EdgeManager = { InteractiveEdge, SelfLoopEdge, DefaultEdge, LoopEdge, RemovableEdge: DefaultEdge };
export default EdgeManager;

