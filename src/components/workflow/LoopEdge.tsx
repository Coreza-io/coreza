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
    style,
    markerEnd,
    data,
  } = props;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={style}
        markerEnd={markerEnd}
      />
      {data?.label && (
        <text>
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
    </>
  );
}
