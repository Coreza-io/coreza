import React from 'react';
import { getSmoothStepPath, EdgeProps } from '@xyflow/react';

export function LoopEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style = {},
    markerEnd,
    data,
  } = props;
  
  const sourceHandle = (props as any).sourceHandle;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  // Style the edge based on whether it's a loop iteration or completion edge
  const isLoopHandle = sourceHandle === 'loop';
  const isDoneHandle = sourceHandle === 'done';
  
  const edgeStyle = {
    ...style,
    stroke: isLoopHandle ? '#22c55e' : isDoneHandle ? '#3b82f6' : style.stroke,
    strokeWidth: isLoopHandle ? 2 : isDoneHandle ? 2 : style.strokeWidth,
    strokeDasharray: isLoopHandle ? '5,5' : isDoneHandle ? '0' : style.strokeDasharray,
  };

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={edgeStyle}
        markerEnd={markerEnd}
      />
      {data?.label && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      {isLoopHandle && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle" fill="#22c55e" fontSize="12">
            loop
          </textPath>
        </text>
      )}
      {isDoneHandle && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle" fill="#3b82f6" fontSize="12">
            done
          </textPath>
        </text>
      )}
    </>
  );
}
