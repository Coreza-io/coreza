import React from 'react';
import { EdgeProps, MarkerType, getSimpleBezierPath, getSmoothStepPath } from '@xyflow/react';
import { Plus, Trash2 } from 'lucide-react';

export interface InteractiveEdgeData {
  label?: string;
  onAddEdge?: () => void;
  onRemoveEdge?: () => void;
}

function InteractiveEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data
}: EdgeProps<InteractiveEdgeData>) {
  const [path] =
    source === target
      ? getSimpleBezierPath({
          sourceX,
          sourceY,
          targetX: sourceX + 40,
          targetY: sourceY - 40,
          curvature: 0.5
        })
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY });

  return (
    <g>
      <path
        id={id}
        className="react-flow__edge-path"
        d={path}
        markerEnd={markerEnd}
        style={{ stroke: '#888', strokeWidth: 2, ...(style || {}), fill: 'none' }}
      />
      <g
        transform={`translate(${(sourceX + targetX) / 2}, ${(sourceY + targetY) / 2})`}
        className="flex gap-1 items-center"
      >
        {data?.label && <text>{data.label}</text>}
        {data?.onAddEdge && <Plus size={12} onClick={data.onAddEdge} className="cursor-pointer" />}
        {data?.onRemoveEdge && <Trash2 size={12} onClick={data.onRemoveEdge} className="cursor-pointer" />}
      </g>
    </g>
  );
}

export const DefaultEdge = (props: EdgeProps<InteractiveEdgeData>) => (
  <InteractiveEdge {...props} data={{ onRemoveEdge: props.data?.onRemoveEdge }} />
);

export const SelfLoopEdge = (props: EdgeProps<InteractiveEdgeData>) => (
  <InteractiveEdge
    {...props}
    style={{ strokeDasharray: '4 2', stroke: '#888', ...(props.style || {}) }}
    markerEnd={{ type: MarkerType.ArrowClosed, color: '#888' }}
    data={props.data}
  />
);

export const LoopEdge = (props: EdgeProps<InteractiveEdgeData>) => (
  <InteractiveEdge
    {...props}
    style={{ stroke: '#22c55e', ...(props.style || {}) }}
    markerEnd={{ type: MarkerType.ArrowClosed, color: '#22c55e' }}
    data={props.data}
  />
);

export { InteractiveEdge };
export default { InteractiveEdge, DefaultEdge, SelfLoopEdge, LoopEdge };

