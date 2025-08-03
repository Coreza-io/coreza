// src/components/workflow/LoopEdge.tsx
import React from "react";
import { getBezierPath, EdgeProps } from "@xyflow/react";

// Controls how far the arc swings around the node
const LOOP_OFFSET = 56;

export const LoopEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  animated,
}) => {
  // Curve from bottom left, swings under node, back to left
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY: sourceY + LOOP_OFFSET,
    sourcePosition: "bottom",
    targetX,
    targetY: targetY + LOOP_OFFSET,
    targetPosition: "left",
    curvature: 0.5,
  });

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path loop-edge-path"
        d={edgePath}
        style={{
          ...style,
          stroke: "#22c55e",
          strokeWidth: 3,
          fill: "none",
        }}
        markerEnd={markerEnd}
        strokeDasharray={animated ? "6 3" : undefined}
      />
    </>
  );
};

export default LoopEdge;

