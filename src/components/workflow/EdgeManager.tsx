import React from 'react';
import { EdgeProps, getSmoothStepPath, MarkerType } from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';

export interface EdgeControl {
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}

export interface InteractiveEdgeProps extends EdgeProps {
  controls?: EdgeControl[];
  loop?: boolean;
  offsetX?: number;
  offsetY?: number;
}

export const InteractiveEdge: React.FC<InteractiveEdgeProps> = ({
  id,
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
  loop = false,
  offsetX = 20,
  offsetY = 60,
}) => {
  const pathD = loop
    ? [
        `M ${sourceX},${sourceY}`,
        `H ${sourceX + offsetX}`,
        `V ${sourceY + offsetY}`,
        `H ${targetX - offsetX}`,
        `V ${targetY}`,
        `H ${targetX}`,
      ].join(' ')
    : getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })[0];

  const midX = (sourceX + targetX) / 2;
  const midY = loop ? sourceY + offsetY : (sourceY + targetY) / 2;

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
    </>
  );
};

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
      loop
      offsetX={20}
      offsetY={80}
      style={{ stroke: '#22c55e', strokeWidth: 3 }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

export const RemovableEdge: React.FC<EdgeProps> = (props) => {
  const { data, selected } = props;
  const controls = selected
    ? [
        { icon: <Trash2 size={12} color="#e11d48" />, onClick: data?.onRemoveEdge as (e: React.MouseEvent) => void },
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

const EdgeManager = { InteractiveEdge, LoopEdge, RemovableEdge };
export default EdgeManager;

