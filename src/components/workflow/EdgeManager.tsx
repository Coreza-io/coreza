import React, { useState } from 'react';
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

// Build edge controls based on available callbacks
const buildControls = (data?: any): EdgeControl[] => {
  const controls: EdgeControl[] = [];
  if (data?.onAddEdge) {
    controls.push({ icon: <Plus size={12} color="#22c55e" />, onClick: data.onAddEdge });
  }
  if (data?.onRemoveEdge) {
    controls.push({ icon: <Trash2 size={12} color="#e11d48" />, onClick: data.onRemoveEdge });
  }
  return controls;
};

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
          `V ${sourceY - offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY - offsetY;
        break;
      case 'bottom':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `V ${sourceY + offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX / 2;
        midY = sourceY + offsetY;
        break;
      case 'left':
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX - offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX}`,
          `V ${targetY}`,
        ].join(' ');
        midX = sourceX - offsetX;
        midY = sourceY + offsetY / 2;
        break;
      case 'right':
      default:
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX + offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX - offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(' ');
        midX = sourceX + offsetX;
        midY = sourceY + offsetY / 2;
        break;
    }
  } else {
    // Regular edge path
    pathD = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];
    midX = (sourceX + targetX) / 2;
    midY = (sourceY + targetY) / 2;
  }

  const [hovered, setHovered] = useState(false);

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <path
        id={id}
        className="react-flow__edge-path"
        d={pathD}
        style={{
          ...style,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          pointerEvents: 'stroke',
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
      {controls.length > 0 && hovered && (
        <foreignObject
          x={midX - 24}
          y={midY - 12}
          width={48}
          height={24}
          style={{ pointerEvents: 'all' }}
        >
          <div
            style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}
          >
            {controls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  padding: '2px',
                  cursor: 'pointer',
                }}
              >
                {ctrl.icon}
              </button>
            ))}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

// Generic Self-Loop Edge for any node
export const SelfLoopEdge: React.FC<EdgeProps> = (props) => {
  const { data, source, target } = props;
  
  // Only apply self-loop styling if it's actually a self-loop
  if (source !== target) {
    return <DefaultEdge {...props} />;
  }

  const controls = buildControls(data);

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
  const { data } = props;
  const controls = buildControls(data);

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
  const { data } = props;
  const controls = buildControls(data);

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

