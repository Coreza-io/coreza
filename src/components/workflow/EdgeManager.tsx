/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useMemo, useState } from "react";
import {
  ConnectionLineComponentProps,
  EdgeProps,
  getSmoothStepPath,
  getBezierPath,
  MarkerType,
  useNodes,
  Position,
} from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";

export interface EdgeControl {
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
}

export interface SelfLoopConfig {
  offsetX?: number;
  offsetY?: number;
  direction?: "top" | "right" | "bottom" | "left";
}

export interface InteractiveEdgeProps extends EdgeProps {
  controls?: EdgeControl[];
  selfLoopConfig?: SelfLoopConfig;
  className?: string;
}

// Build edge controls based on available callbacks
const buildControls = (data?: any): EdgeControl[] => {
  const controls: EdgeControl[] = [];
  if (data?.onAddEdge) {
    controls.push({
      icon: <Plus size={12} color="#22c55e" />,
      onClick: data.onAddEdge,
    });
  }
  if (data?.onRemoveEdge) {
    controls.push({
      icon: <Trash2 size={12} color="#e11d48" />,
      onClick: data.onRemoveEdge,
    });
  }
  return controls;
};

const normalizeHex = (hex: string): string | null => {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  if (value.length === 3) {
    return `#${value
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  return `#${value}`;
};

const FEMALE_PLUG_PATH =
  "M 23.707 0.293 c -0.391 -0.391 -1.023 -0.391 -1.414 0 l -2.58 2.58 c -2.004 -1.344 -4.749 -1.132 -6.519 0.638 l -1.135 1.135 l -0.353 -0.353 c -0.391 -0.391 -1.023 -0.391 -1.414 0 s -0.391 1.023 0 1.414 l 8 8 c 0.195 0.195 0.451 0.293 0.707 0.293 s 0.512 -0.098 0.707 -0.293 c 0.391 -0.391 0.391 -1.023 0 -1.414 l -0.353 -0.353 l 1.135 -1.135 c 1.77 -1.769 1.982 -4.515 0.638 -6.519 l 2.58 -2.58 c 0.391 -0.391 0.391 -1.023 0 -1.414 Z";
interface PlugIconProps {
  color?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const MALE_PLUG_PATH =
  "m12.707,12.707l-2.293,2.293-1.414-1.414,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0l-2.293,2.293-1.879-1.879c-.391-.391-1.023-.391-1.414,0s-.391,1.023,0,1.414l.352.352-1.134,1.135c-1.77,1.769-1.982,4.515-.638,6.519l-2.58,2.58c-.391.391-.391,1.023,0,1.414.195.195.451.293.707.293s.512-.098.707-.293l2.58-2.58c.865.58,1.868.871,2.871.871,1.321,0,2.642-.503,3.647-1.509l1.135-1.134.352.352c.195.195.451.293.707.293s.512-.098.707-.293c.391-.391.391-1.023,0-1.414l-1.879-1.879,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0Zm-3.315,6.368c-1.232,1.23-3.234,1.23-4.467,0-1.231-1.231-1.231-3.235,0-4.467l1.134-1.135,4.467,4.467-1.135,1.134Z";
interface PlugIconProps {
  color?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const mergeIconStyle = (style?: React.CSSProperties): React.CSSProperties => ({
  pointerEvents: "none",
  transformOrigin: "center",
  ...(style ?? {}),
});

export const MalePlugIcon: React.FC<PlugIconProps> = ({
  color = "#6b7280",
  size = 24,
  className,
  style,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    style={mergeIconStyle(style)}
  >
    <path d={MALE_PLUG_PATH} fill={color} />
  </svg>
);

export const FemalePlugIcon: React.FC<PlugIconProps> = ({
  color = "#6b7280",
  size = 24,
  className,
  style,
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    style={mergeIconStyle(style)}
  >
    <path d={FEMALE_PLUG_PATH} fill={color} />
  </svg>
);
export const ConnectedSwitchIcon: React.FC<PlugIconProps> = ({
  color = "#6b7280",
  size = 24,
  className,
  style,
}) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} className={className} style={mergeIconStyle(style)}>
    <path d="M23.707,0.293c-0.391-0.391-1.023-0.391-1.414,0l-2.58,2.58c-2.004-1.344-4.749-1.132-6.519,0.638l-1.135,1.135l-0.353-0.353c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414l8,8c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-0.353-0.353l1.135-1.135c1.77-1.769,1.982-4.515,0.638-6.519l2.58-2.58c0.391-0.391,0.391-1.023,0-1.414Z" fill={color} />
    <path d="M19.707,5.707l-2.293,2.293-1.414-1.414,2.293-2.293c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0l-2.293,2.293-1.879-1.879c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414l0.352,0.352-1.134,1.135c-1.77,1.769-1.982,4.515-0.638,6.519l-2.58,2.58c-0.391,0.391-0.391,1.023,0,1.414c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293l2.58-2.58c0.865,0.58,1.868,0.871,2.871,0.871,1.321,0,2.642-0.503,3.647-1.509l1.135-1.134l0.352,0.352c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.879-1.879,2.293-2.293c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0Zm-3.315,6.368c-1.232,1.23-3.234,1.23-4.467,0-1.231-1.231-1.231-3.235,0-4.467l1.134-1.135,4.467,4.467-1.135,1.134Z" fill={color} />
  </svg>
);

const lightenHex = (hex: string, amount: number): string => {
  const normalized = normalizeHex(hex);
  if (!normalized) return hex;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const mix = (channel: number) =>
    clamp(Math.round(channel + (255 - channel) * amount));

  return `#${[mix(r), mix(g), mix(b)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
};

const isExecutingClass = (className?: string): boolean => {
  if (!className) return false;
  return className.split(" ").some((cls) => cls.trim() === "executing-edge");
};

// Helper function to build orthogonal paths with rounded corners
const buildOrthogonalPath = (
  x1: number, y1: number,  // Start
  x2: number, y2: number,  // After first segment (corner 1)
  x3: number, y3: number,  // After second segment (corner 2)
  x4: number, y4: number,  // After third segment (corner 3)
  x5: number, y5: number,  // After fourth segment (corner 4)
  x6: number, y6: number,  // End
  radius: number
): string => {
  // Helper to create a rounded corner between two segments
  const roundedCorner = (
    prevX: number, prevY: number,  // Previous point
    cornerX: number, cornerY: number,  // Corner point
    nextX: number, nextY: number,  // Next point
    r: number
  ): string => {
    // Direction vectors
    const dx1 = cornerX - prevX;
    const dy1 = cornerY - prevY;
    const dx2 = nextX - cornerX;
    const dy2 = nextY - cornerY;
    
    // Normalize and get the offset for the curve start/end
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    if (len1 === 0 || len2 === 0) {
      return `L ${cornerX},${cornerY}`;
    }
    
    // Clamp radius to half the shorter segment
    const maxR = Math.min(len1, len2) / 2;
    const actualR = Math.min(r, maxR);
    
    // Points where the curve starts and ends
    const startX = cornerX - (dx1 / len1) * actualR;
    const startY = cornerY - (dy1 / len1) * actualR;
    const endX = cornerX + (dx2 / len2) * actualR;
    const endY = cornerY + (dy2 / len2) * actualR;
    
    // Quadratic bezier with corner as control point
    return `L ${startX},${startY} Q ${cornerX},${cornerY} ${endX},${endY}`;
  };

  const segments: string[] = [`M ${x1},${y1}`];
  
  // Corner 1: from (x1,y1) through (x2,y2) to (x3,y3)
  segments.push(roundedCorner(x1, y1, x2, y2, x3, y3, radius));
  
  // Corner 2: from (x2,y2) through (x3,y3) to (x4,y4)
  segments.push(roundedCorner(x2, y2, x3, y3, x4, y4, radius));
  
  // Corner 3: from (x3,y3) through (x4,y4) to (x5,y5)
  segments.push(roundedCorner(x3, y3, x4, y4, x5, y5, radius));
  
  // Corner 4: from (x4,y4) through (x5,y5) to (x6,y6)
  segments.push(roundedCorner(x4, y4, x5, y5, x6, y6, radius));
  
  // Final segment to end point
  segments.push(`L ${x6},${y6}`);
  
  return segments.join(" ");
};

const calculateSmartPath = (
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  nodes: any[],
  sourceNodeId: string,
  targetNodeId: string
): { path: string; midX: number; midY: number } => {
  const turnOffset = 40; // Fixed turn distance for orthogonal routing
  const radius = 20; // Corner radius for smooth curves
  const nodePadding = 20;
  const defaultNodeWidth = 340;
  const defaultNodeHeight = 340;

  const sourceNode = nodes.find(n => n.id === sourceNodeId);
  const targetNode = nodes.find(n => n.id === targetNodeId);

  const sourceWidth = (sourceNode?.measured?.width || sourceNode?.width || defaultNodeWidth);
  const sourceHeight = (sourceNode?.measured?.height || sourceNode?.height || defaultNodeHeight);
  const targetWidth = (targetNode?.measured?.width || targetNode?.width || defaultNodeWidth);
  const targetHeight = (targetNode?.measured?.height || targetNode?.height || defaultNodeHeight);

  // Get actual node positions for routing calculations
  const sourceNodeY = sourceNode?.position?.y || sourceY - sourceHeight / 2;
  const targetNodeY = targetNode?.position?.y || targetY - targetHeight / 2;
  const sourceNodeX = sourceNode?.position?.x || sourceX - sourceWidth / 2;
  const targetNodeX = targetNode?.position?.x || targetX - targetWidth / 2;

  // Handle Right → Left connections (most common case with backward routing)
  if (sourcePosition === Position.Right && targetPosition === Position.Left) {
    const isBackward = targetX < sourceX;
    
    if (isBackward) {
      // Orthogonal routing for backward connections
      const exitX = sourceX + turnOffset;
      const entryX = targetX - turnOffset; // FIXED: entry on correct side
      
      // Calculate routing level - go above or below both nodes
      const sourceTop = sourceNodeY;
      const sourceBottom = sourceNodeY + sourceHeight;
      const targetTop = targetNodeY;
      const targetBottom = targetNodeY + targetHeight;
      
      const goAbove = targetY < sourceY;
      const routeY = goAbove
        ? Math.min(targetTop, sourceTop) - nodePadding
        : Math.max(sourceBottom, targetBottom) + nodePadding;
      
      // Build 5-segment orthogonal path with rounded corners
      const path = buildOrthogonalPath(
        sourceX, sourceY,      // Start point
        exitX, sourceY,        // After first horizontal
        exitX, routeY,         // After first vertical
        entryX, routeY,        // After second horizontal
        entryX, targetY,       // After second vertical
        targetX, targetY,      // End point
        radius
      );
      
      // Calculate midpoint on the horizontal routing segment
      const midX = (exitX + entryX) / 2;
      const midY = routeY;
      
      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const path = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })[0];
      
      // Use simple average for forward connections
      const midX = (sourceX + targetX) / 2;
      const midY = (sourceY + targetY) / 2;
      
      return { path, midX, midY };
    }
  }
  
  // Handle Left → Right connections
  if (sourcePosition === Position.Left && targetPosition === Position.Right) {
    const isBackward = targetX > sourceX;
    
    if (isBackward) {
      const exitX = sourceX - turnOffset;
      const entryX = targetX + turnOffset;
      
      const sourceTop = sourceNodeY;
      const sourceBottom = sourceNodeY + sourceHeight;
      const targetTop = targetNodeY;
      const targetBottom = targetNodeY + targetHeight;
      
      const goAbove = targetY < sourceY;
      const routeY = goAbove
        ? Math.min(targetTop, sourceTop) - nodePadding
        : Math.max(sourceBottom, targetBottom) + nodePadding;
      
      const path = buildOrthogonalPath(
        sourceX, sourceY,
        exitX, sourceY,
        exitX, routeY,
        entryX, routeY,
        entryX, targetY,
        targetX, targetY,
        radius
      );
      
      // Calculate midpoint on the horizontal routing segment
      const midX = (exitX + entryX) / 2;
      const midY = routeY;
      
      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const path = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })[0];
      
      // Use simple average for forward connections
      const midX = (sourceX + targetX) / 2;
      const midY = (sourceY + targetY) / 2;
      
      return { path, midX, midY };
    }
  }

  // Handle Bottom → Top connections
  if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
    const isBackward = targetY < sourceY;
    
    if (isBackward) {
      const exitY = sourceY + turnOffset;
      const entryY = targetY - turnOffset;
      
      const sourceLeft = sourceNodeX;
      const sourceRight = sourceNodeX + sourceWidth;
      const targetLeft = targetNodeX;
      const targetRight = targetNodeX + targetWidth;
      
      const goLeft = targetX < sourceX;
      const routeX = goLeft
        ? Math.min(targetLeft, sourceLeft) - nodePadding
        : Math.max(sourceRight, targetRight) + nodePadding;
      
      const path = buildOrthogonalPath(
        sourceX, sourceY,
        sourceX, exitY,
        routeX, exitY,
        routeX, entryY,
        targetX, entryY,
        targetX, targetY,
        radius
      );
      
      // Calculate midpoint on the vertical routing segment
      const midX = routeX;
      const midY = (exitY + entryY) / 2;
      
      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const path = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })[0];
      
      // Use simple average for forward connections
      const midX = (sourceX + targetX) / 2;
      const midY = (sourceY + targetY) / 2;
      
      return { path, midX, midY };
    }
  }

  // Handle Top → Bottom connections
  if (sourcePosition === Position.Top && targetPosition === Position.Bottom) {
    const isBackward = targetY > sourceY;
    
    if (isBackward) {
      const exitY = sourceY - turnOffset;
      const entryY = targetY + turnOffset;
      
      const sourceLeft = sourceNodeX;
      const sourceRight = sourceNodeX + sourceWidth;
      const targetLeft = targetNodeX;
      const targetRight = targetNodeX + targetWidth;
      
      const goLeft = targetX < sourceX;
      const routeX = goLeft
        ? Math.min(targetLeft, sourceLeft) - nodePadding
        : Math.max(sourceRight, targetRight) + nodePadding;
      
      const path = buildOrthogonalPath(
        sourceX, sourceY,
        sourceX, exitY,
        routeX, exitY,
        routeX, entryY,
        targetX, entryY,
        targetX, targetY,
        radius
      );
      
      // Calculate midpoint on the vertical routing segment
      const midX = routeX;
      const midY = (exitY + entryY) / 2;
      
      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const path = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })[0];
      
      // Use simple average for forward connections
      const midX = (sourceX + targetX) / 2;
      const midY = (sourceY + targetY) / 2;
      
      return { path, midX, midY };
    }
  }

  // Default fallback - use bezier for smooth curves
  const path = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })[0];
  
  // Use simple average for default case
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;
  
  return { path, midX, midY };
};

export const PlugEdge: React.FC<InteractiveEdgeProps> = ({
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
  animated,
  className,
}) => {
  const [hovered, setHovered] = useState(false);
  const computedControls = controls.length > 0 ? controls : buildControls(data);
  const isSelfLoop = source === target;
  const sparkId = useMemo(() => `plug-edge-spark-${id}`, [id]);
  const nodes = useNodes();

  if (isSelfLoop) {
    return (
      <InteractiveEdge
        id={id}
        source={source}
        target={target}
        sourceX={sourceX - 25}
        sourceY={sourceY}
        targetX={targetX + 25}
        targetY={targetY}
        sourcePosition={sourcePosition}
        targetPosition={targetPosition}
        style={{ stroke: "#6366f1", strokeWidth: 2, ...style }}
        markerEnd={markerEnd}
        data={data}
        controls={computedControls}
        selfLoopConfig={selfLoopConfig}
      />
    );
  }

  const customStyle: React.CSSProperties = { ...(style || {}) };
  const strokeValue = customStyle.stroke;
  const strokeWidthValue = customStyle.strokeWidth;
  delete customStyle.stroke;
  delete customStyle.strokeWidth;

  const cordColor = typeof strokeValue === "string" ? strokeValue : "#64748b";
  const strokeWidth =
    typeof strokeWidthValue === "number"
      ? strokeWidthValue
      : strokeWidthValue
        ? Number.parseFloat(String(strokeWidthValue)) || 3
        : 3;

  const glowColor = lightenHex(cordColor, 0.5);
  const sparkColor = lightenHex(cordColor, 0.7);
  const sparkOuter = lightenHex(cordColor, 0.85);
  const executing = isExecutingClass(className);

  const extensionDistance = -25;
  const extendedSourceX = sourcePosition === "left" ? sourceX - extensionDistance :
    sourcePosition === "right" ? sourceX + extensionDistance : sourceX;
  const extendedSourceY = sourcePosition === "top" ? sourceY - extensionDistance :
    sourcePosition === "bottom" ? sourceY + extensionDistance : sourceY;
  const extendedTargetX = targetPosition === "left" ? targetX - extensionDistance :
    targetPosition === "right" ? targetX + extensionDistance : targetX;
  const extendedTargetY = targetPosition === "top" ? targetY - extensionDistance :
    targetPosition === "bottom" ? targetY + extensionDistance : targetY;

  const { path: edgePath, midX, midY } = calculateSmartPath(
    extendedSourceX,
    extendedSourceY,
    extendedTargetX,
    extendedTargetY,
    sourcePosition,
    targetPosition,
    nodes,
    source,
    target
  );

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="plug-edge p-2"
    >
      <defs>
        <radialGradient
          id={sparkId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={sparkOuter} stopOpacity={0.95} />
          <stop offset="0.55" stopColor={sparkColor} stopOpacity={0.85} />
          <stop offset="1" stopColor={sparkColor} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* Invisible wider path for better hover detection */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={3}
        fill="none"
        style={{ pointerEvents: "stroke" }}
      />
      <path
        d={edgePath}
        className={`plug-edge__glow${executing ? " plug-edge__glow--active" : ""
          }`}
        stroke={glowColor}
        strokeWidth={strokeWidth + 6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ pointerEvents: "none" }}
      />
      <path
        id={id}
        d={edgePath}
        className={[
          "react-flow__edge-path",
          "plug-edge__cord",
          className || "",
          animated ? "plug-edge__cord--animated" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        stroke={cordColor}
        strokeWidth={strokeWidth}
        markerEnd={markerEnd}
        fill="none"
        style={{
          ...customStyle,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          pointerEvents: "none",
        }}
      />
      <circle
        cx={midX}
        cy={midY}
        r={6}
        fill={`url(#${sparkId})`}
        className={`plug-edge__spark${executing ? " plug-edge__spark--active" : ""
          }`}
      />
      {data?.label && (
        <text className="react-flow__edge-text">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      {computedControls.length > 0 && hovered && (
        <foreignObject
          x={midX - 30}
          y={midY - 15}
          width={60}
          height={30}
          style={{ pointerEvents: "all", overflow: "visible" }}
        >
          <div
            style={{
              display: "flex",
              gap: "6px",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            {computedControls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f3f4f6";
                  e.currentTarget.style.transform = "scale(1.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.transform = "scale(1)";
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

export const PlugConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineStyle,
  connectionStatus,
  fromHandle,
}) => {
  const style: React.CSSProperties = { ...(connectionLineStyle || {}) };

  const baseStroke =
    typeof style.stroke === "string"
      ? style.stroke
      : connectionStatus === "invalid"
        ? "#ef4444"
        : "#64748b";

  const strokeWidth =
    typeof style.strokeWidth === "number"
      ? style.strokeWidth
      : style.strokeWidth
        ? Number.parseFloat(String(style.strokeWidth)) || 3
        : 3;

  const cordColor = connectionStatus === "invalid" ? "#ef4444" : baseStroke;
  const glowColor = lightenHex(cordColor, 0.5);

  // Use smooth step path for connection line to route around nodes
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    // borderRadius: 10,
  });

  const fromType = fromHandle?.type ?? "source";
  const draggingFromSource = fromType === "source";

  const anchorX = draggingFromSource ? fromX : toX;
  const anchorY = draggingFromSource ? fromY : toY;
  const pointerX = draggingFromSource ? toX : fromX;
  const pointerY = draggingFromSource ? toY : fromY;

  const angle = Math.atan2(pointerY - anchorY, pointerX - anchorX);
  const degrees = (angle * 180) / Math.PI;
  return (
    <g className="plug-edge plug-edge--connection">
      <defs>
        <filter id="plug-glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path
        d={edgePath}
        className="plug-edge__glow plug-edge__glow--connecting"
        stroke={glowColor}
        strokeWidth={strokeWidth + 6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        style={{ pointerEvents: "none" }}
      />
      <path
        d={edgePath}
        className="plug-edge__cord plug-edge__cord--connecting"
        stroke={cordColor}
        strokeWidth={strokeWidth}
        fill="none"
        style={{
          ...style,
          stroke: cordColor,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          pointerEvents: "stroke",
        }}
      />

      {/* Male plug that follows cursor */}
      <g transform={`translate(${toX + 15}, ${toY - 15})`}>
        <g
          transform={`rotate(${45})`}
          className="plug-edge__plug-dragging-inner"
        >
          <path
            d={MALE_PLUG_PATH}
            fill={cordColor}
            transform="translate(0, 0) scale(0.9)"
            style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
          />
        </g>
      </g>
    </g>
  );
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
  const nodes = useNodes();
  // Detect self-loop (when source connects to target on same node)
  const isSelfLoop = source === target;

  // Default self-loop configuration
  const defaultSelfLoopConfig: SelfLoopConfig = {
    offsetX: 40,
    offsetY: 80,
    direction: "right",
  };

  const loopConfig = { ...defaultSelfLoopConfig, ...selfLoopConfig };

  let pathD: string;
  let midX: number;
  let midY: number;
  if (isSelfLoop) {
    // Create self-loop path based on direction
    const { offsetX = 40, offsetY = 80, direction = "right" } = loopConfig;

    switch (direction) {
      case "top":
        pathD = [
          `M ${sourceX},${sourceY}`,
          `V ${sourceY - offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(" ");
        midX = sourceX + offsetX / 2;
        midY = sourceY - offsetY;
        break;
      case "bottom":
        pathD = [
          `M ${sourceX},${sourceY}`,
          `V ${sourceY + offsetY}`,
          `H ${sourceX + offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(" ");
        midX = sourceX + offsetX / 2;
        midY = sourceY + offsetY;
        break;
      case "left":
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX - offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX}`,
          `V ${targetY}`,
        ].join(" ");
        midX = sourceX - offsetX;
        midY = sourceY + offsetY / 2;
        break;
      case "right":
      default:
        pathD = [
          `M ${sourceX},${sourceY}`,
          `H ${sourceX + offsetX}`,
          `V ${sourceY + offsetY}`,
          `H ${targetX - offsetX}`,
          `V ${targetY}`,
          `H ${targetX}`,
        ].join(" ");
        midX = sourceX + offsetX;
        midY = sourceY + offsetY / 2;
        break;
    }
  } else {
    // Regular edge path - use smart path calculation to route around nodes
    const result = calculateSmartPath(
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      nodes,
      source,
      target
    );
    pathD = result.path;
    midX = result.midX;
    midY = result.midY;
  }

  const [hovered, setHovered] = useState(false);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible wider path for better hover detection */}
      <path
        d={pathD}
        stroke="transparent"
        strokeWidth={1}
        fill="none"
        style={{ pointerEvents: "stroke" }}
      />
      <path
        id={id}
        className="react-flow__edge-path"
        d={pathD}
        style={{
          ...style,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          pointerEvents: "none",
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
          x={midX - 30}
          y={midY - 15}
          width={60}
          height={30}
          style={{ pointerEvents: "all", overflow: "visible" }}
        >
          <div
            style={{
              display: "flex",
              gap: "6px",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            {controls.map((ctrl, i) => (
              <button
                key={i}
                type="button"
                onClick={ctrl.onClick}
                style={{
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  padding: "10px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f3f4f6";
                  e.currentTarget.style.transform = "scale(1.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#fff";
                  e.currentTarget.style.transform = "scale(1)";
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
        direction:
          (data?.direction as "top" | "right" | "bottom" | "left") || "right",
      }}
      style={{
        stroke: (data?.loopColor as string) || "#6366f1",
        strokeWidth: 2,
        strokeDasharray: "5,5",
      }}
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
    <PlugEdge
      {...props}
      controls={controls}
      data={data}
      style={{ stroke: "#64748b", strokeWidth: 3, ...props.style }}
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
      selfLoopConfig={{ offsetX: 20, offsetY: 80, direction: "right" }}
      style={{ stroke: "#22c55e", strokeWidth: 3 }}
      markerEnd={MarkerType.ArrowClosed}
      controls={controls}
      data={{ label: data?.label }}
    />
  );
};

const EdgeManager = {
  InteractiveEdge,
  PlugEdge,
  PlugConnectionLine,
  SelfLoopEdge,
  DefaultEdge,
  LoopEdge,
  RemovableEdge: DefaultEdge,
};
export default EdgeManager;
