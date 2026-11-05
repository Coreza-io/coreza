/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useContext } from "react";
import { EdgeEditingContext } from "@/contexts/EdgeEditingContext";
import { useEdgeToolbarHover } from "@/hooks/useEdgeToolbarHover";
import { useEdgeEndpointsExpanded } from "@/hooks/useNodeExpansion";
import { useAgentParticipantActive } from "@/stores/agentActivityStore";
import {
  ConnectionLineComponentProps,
  EdgeProps,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  MarkerType,
  useStore,
  Position,
} from "@xyflow/react";
import type { ReactFlowState } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import {
  NODE_VISUAL_THEMES,
  DEFAULT_NODE_VISUAL_THEME,
} from "@/components/nodes/constants/nodeVisualThemes";
import { resolveNodeVisualCategory } from "@/components/nodes/constants/resolveNodeVisualCategory";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

export interface EdgeControl {
  icon: React.ReactNode;
  label?: string;
  action?: "delete";
  onClick?: (e: React.MouseEvent) => void;
}

export interface InteractiveEdgeProps extends EdgeProps {
  controls?: EdgeControl[];
  className?: string;
}

// Delete availability is editor-owned; template/JSON edges need no stored callback.
const buildControls = (data: any, canDelete: boolean): EdgeControl[] => {
  const controls: EdgeControl[] = [];
  if (data?.onAddEdge) {
    controls.push({
      icon: <Plus size={14} />,
      label: "Add connection",
      onClick: data.onAddEdge,
    });
  }
  if (canDelete) {
    controls.push({
      icon: <Trash2 size={12} />,
      label: "Delete connection",
      action: "delete",
    });
  }
  return controls;
};

const EDGE_STROKE_WIDTH = 1;
const EDGE_INTERACTION_WIDTH = 40;
const readStrokeWidth = (
  value?: React.CSSProperties["strokeWidth"],
): number => {
  const width = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(width) ? width : EDGE_STROKE_WIDTH;
};

const EdgeToolbar = ({
  edgeId,
  x,
  y,
  controls,
  hover,
}: {
  edgeId: string;
  x: number;
  y: number;
  controls: EdgeControl[];
  hover: ReturnType<typeof useEdgeToolbarHover>;
}) => {
  const editing = useContext(EdgeEditingContext);
  if (!hover.visible) return null;
  return (
    <EdgeLabelRenderer>
      <div
        className="edge-toolbar nodrag nopan absolute flex gap-1 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-lg"
        style={{
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          pointerEvents: "all",
          zIndex: 1100,
        }}
        onMouseEnter={hover.onToolbarEnter}
        onMouseLeave={hover.onToolbarLeave}
        onFocusCapture={hover.onFocus}
        onBlurCapture={hover.onBlur}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") hover.close();
        }}
        role="group"
        aria-label="Connection controls"
      >
        {controls.map((control, index) => (
          <button
            key={index}
            type="button"
            aria-label={control.label ?? "Connection action"}
            data-testid={
              control.label === "Delete connection"
                ? "edge-delete-button"
                : undefined
            }
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onClick={(event) => {
              event.stopPropagation();
              if (!editing.enabled || !editing.canEdit()) {
                hover.close();
                return;
              }
              if (control.action === "delete") editing.removeEdge(edgeId);
              else control.onClick?.(event);
              hover.close();
            }}
          >
            {control.icon}
          </button>
        ))}
      </div>
    </EdgeLabelRenderer>
  );
};

/** Narrow subscription: only the source node's visual category. */
const useSourceNodeTheme = (nodeId: string | undefined) => {
  const category = useStore((state: ReactFlowState) => {
    if (!nodeId) return null;
    const data = state.nodeLookup.get(nodeId)?.data as
      | { definition?: unknown }
      | undefined;
    return resolveNodeVisualCategory(data?.definition);
  });
  if (category === null) return DEFAULT_NODE_VISUAL_THEME;
  return NODE_VISUAL_THEMES[category] ?? DEFAULT_NODE_VISUAL_THEME;
};

interface EndpointBounds {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}

type EndpointPair = readonly [EndpointBounds | null, EndpointBounds | null];

const toBounds = (state: ReactFlowState, id: string): EndpointBounds | null => {
  const node = state.nodeLookup.get(id);
  if (!node) return null;
  return {
    id,
    position: { ...node.internals.positionAbsolute },
    measured: { width: node.measured?.width, height: node.measured?.height },
    width: node.width,
    height: node.height,
  };
};

const sameBounds = (
  a: EndpointBounds | null,
  b: EndpointBounds | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.measured?.width === b.measured?.width &&
    a.measured?.height === b.measured?.height &&
    a.width === b.width &&
    a.height === b.height
  );
};

/** Narrow subscription: only source/target routing geometry, O(1) lookup. */
const useEndpointBounds = (
  source: string,
  target: string,
): EndpointBounds[] => {
  const pair = useStore(
    (state: ReactFlowState): EndpointPair => [
      toBounds(state, source),
      toBounds(state, target),
    ],
    (a: EndpointPair, b: EndpointPair) =>
      sameBounds(a[0], b[0]) && sameBounds(a[1], b[1]),
  );
  return React.useMemo(
    () => pair.filter((bounds): bounds is EndpointBounds => bounds !== null),
    [pair],
  );
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
  "M 19.713 2.873 c -2.004 -1.344 -4.749 -1.132 -6.519 0.638 l -1.135 1.135 l -0.353 -0.353 c -0.391 -0.391 -1.023 -0.391 -1.414 0 s -0.391 1.023 0 1.414 l 8 8 c 0.195 0.195 0.451 0.293 0.707 0.293 s 0.512 -0.098 0.707 -0.293 c 0.391 -0.391 0.391 -1.023 0 -1.414 l -0.353 -0.353 l 1.135 -1.135 c 1.77 -1.769 1.982 -4.515 0.638 -6.519 Z M 12.536 7.934 L 14.064 6.407 L 14.550 6.893 L 13.022 8.421 Z M 15.262 10.661 L 16.790 9.134 L 17.276 9.620 L 15.748 11.148 Z";
interface PlugIconProps {
  color?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const MALE_PLUG_PATH =
  "m12.707,12.707l-2.293,2.293-1.414-1.414,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0l-2.293,2.293-1.879-1.879c-.391-.391-1.023-.391-1.414,0s-.391,1.023,0,1.414l.352.352-1.134,1.135c-1.77,1.769-1.982,4.515-.638,6.519l-2.58,2.58c-.391.391-.391,1.023,0,1.414.195.195.451.293.707.293s.512-.098.707-.293l2.58-2.58c.865.58,1.868.871,2.871.871,1.321,0,2.642-.503,3.647-1.509l1.135-1.134.352.352c.195.195.451.293.707.293s.512-.098.707-.293c.391-.391.391-1.023,0-1.414l-1.879-1.879,2.293-2.293c.391-.391.391-1.023,0-1.414s-1.023-.391-1.414,0Z";
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
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={className}
    style={mergeIconStyle(style)}
  >
    <path
      d="M 19.713 2.873 c -2.004 -1.344 -4.749 -1.132 -6.519 0.638 l -1.135 1.135 l -0.353 -0.353 c -0.391 -0.391 -1.023 -0.391 -1.414 0 s -0.391 1.023 0 1.414 l 8 8 c 0.195 0.195 0.451 0.293 0.707 0.293 s 0.512 -0.098 0.707 -0.293 c 0.391 -0.391 0.391 -1.023 0 -1.414 l -0.353 -0.353 l 1.135 -1.135 c 1.77 -1.769 1.982 -4.515 0.638 -6.519 Z"
      fill={color}
    />
    <path
      d="M19.707,5.707l-2.293,2.293-1.414-1.414,2.293-2.293c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0l-2.293,2.293-1.879-1.879c-0.391-0.391-1.023-0.391-1.414,0s-0.391,1.023,0,1.414l0.352,0.352-1.134,1.135c-1.77,1.769-1.982,4.515-0.638,6.519l1.414,1.414c0.865,0.58,1.868,0.871,2.871,0.871,1.321,0,2.642-0.503,3.647-1.509l1.135-1.134l0.352,0.352c0.195,0.195,0.451,0.293,0.707,0.293s0.512-0.098,0.707-0.293c0.391-0.391,0.391-1.023,0-1.414l-1.879-1.879,2.293-2.293c0.391-0.391,0.391-1.023,0-1.414s-1.023-0.391-1.414,0Z"
      fill={color}
    />
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
  x1: number,
  y1: number, // Start
  x2: number,
  y2: number, // After first segment (corner 1)
  x3: number,
  y3: number, // After second segment (corner 2)
  x4: number,
  y4: number, // After third segment (corner 3)
  x5: number,
  y5: number, // After fourth segment (corner 4)
  x6: number,
  y6: number, // End
  radius: number,
): string => {
  // Helper to create a rounded corner between two segments
  const roundedCorner = (
    prevX: number,
    prevY: number, // Previous point
    cornerX: number,
    cornerY: number, // Corner point
    nextX: number,
    nextY: number, // Next point
    r: number,
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
  targetNodeId: string,
): { path: string; midX: number; midY: number } => {
  const turnOffset = 40; // Fixed turn distance for orthogonal routing
  const radius = 20; // Corner radius for smooth curves
  const nodePadding = 20;
  const defaultNodeWidth = 340;
  const defaultNodeHeight = 340;

  const sourceNode = nodes.find((n) => n.id === sourceNodeId);
  const targetNode = nodes.find((n) => n.id === targetNodeId);

  const sourceWidth =
    sourceNode?.measured?.width || sourceNode?.width || defaultNodeWidth;
  const sourceHeight =
    sourceNode?.measured?.height || sourceNode?.height || defaultNodeHeight;
  const targetWidth =
    targetNode?.measured?.width || targetNode?.width || defaultNodeWidth;
  const targetHeight =
    targetNode?.measured?.height || targetNode?.height || defaultNodeHeight;

  // Get actual node positions for routing calculations
  const sourceNodeY = sourceNode?.position?.y ?? sourceY - sourceHeight / 2;
  const targetNodeY = targetNode?.position?.y ?? targetY - targetHeight / 2;
  const sourceNodeX = sourceNode?.position?.x ?? sourceX - sourceWidth / 2;
  const targetNodeX = targetNode?.position?.x ?? targetX - targetWidth / 2;

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
        sourceX,
        sourceY, // Start point
        exitX,
        sourceY, // After first horizontal
        exitX,
        routeY, // After first vertical
        entryX,
        routeY, // After second horizontal
        entryX,
        targetY, // After second vertical
        targetX,
        targetY, // End point
        radius,
      );

      // Calculate midpoint on the horizontal routing segment
      const midX = (exitX + entryX) / 2;
      const midY = routeY;

      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const [path, midX, midY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

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
        sourceX,
        sourceY,
        exitX,
        sourceY,
        exitX,
        routeY,
        entryX,
        routeY,
        entryX,
        targetY,
        targetX,
        targetY,
        radius,
      );

      // Calculate midpoint on the horizontal routing segment
      const midX = (exitX + entryX) / 2;
      const midY = routeY;

      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const [path, midX, midY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

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
        sourceX,
        sourceY,
        sourceX,
        exitY,
        routeX,
        exitY,
        routeX,
        entryY,
        targetX,
        entryY,
        targetX,
        targetY,
        radius,
      );

      // Calculate midpoint on the vertical routing segment
      const midX = routeX;
      const midY = (exitY + entryY) / 2;

      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const [path, midX, midY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

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
        sourceX,
        sourceY,
        sourceX,
        exitY,
        routeX,
        exitY,
        routeX,
        entryY,
        targetX,
        entryY,
        targetX,
        targetY,
        radius,
      );

      // Calculate midpoint on the vertical routing segment
      const midX = routeX;
      const midY = (exitY + entryY) / 2;

      return { path, midX, midY };
    } else {
      // Simple forward connection - use bezier for smooth curve
      const [path, midX, midY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

      return { path, midX, midY };
    }
  }

  // Default fallback - use bezier for smooth curves
  const [path, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return { path, midX, midY };
};

const useAgentEdgeActive = (
  id: string,
  source: string,
  target: string,
  data: any,
): boolean => {
  const canonicalSource =
    typeof data?.canonicalSource === "string" ? data.canonicalSource : source;
  const canonicalTarget =
    typeof data?.canonicalTarget === "string" ? data.canonicalTarget : target;
  const session = useStore((state: ReactFlowState) =>
    String(
      state.nodeLookup.get(canonicalTarget)?.data?.workflowSessionId ?? "",
    ),
  );
  return useAgentParticipantActive(
    session,
    [canonicalSource, canonicalTarget],
    id,
  );
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
  animated,
  className,
}) => {
  const editing = useContext(EdgeEditingContext);
  const endpointExpanded = useEdgeEndpointsExpanded(source, target);
  const canDelete = editing.deletableEdgeIds.has(id);
  const computedControls = (controls.length > 0 ? controls : buildControls(data, canDelete))
    .filter(control => control.action !== "delete" || canDelete);
  const hover = useEdgeToolbarHover(`${editing.sessionId}:${id}`, !endpointExpanded && editing.enabled && computedControls.length > 0, editing.canEdit, editing.sessionId);
  const agentActive = useAgentEdgeActive(id, source, target, data);
  const sourceTheme = useSourceNodeTheme(source);
  const nodes = useEndpointBounds(source, target);
  const isDarkMode = useResolvedTheme() === "dark";

  if (endpointExpanded) return null;

  const customStyle: React.CSSProperties = { ...(style || {}) };
  const strokeValue = customStyle.stroke;
  const strokeWidthValue = customStyle.strokeWidth;
  delete customStyle.stroke;
  delete customStyle.strokeWidth;

  const categoryCordColor = sourceTheme.edgeColor ?? "#22d3ee";
  const defaultCordColor = isDarkMode ? categoryCordColor : "#9ca3af";
  const cordColor =
    typeof strokeValue === "string" ? strokeValue : defaultCordColor;
  const strokeWidth = readStrokeWidth(strokeWidthValue);

  const extensionDistance = -25;
  const topHandleVisualOffset = 35;

  const extendedSourceX =
    sourcePosition === "left"
      ? sourceX - extensionDistance
      : sourcePosition === "right"
        ? sourceX + extensionDistance
        : sourceX;

  const extendedSourceY =
    sourcePosition === "top"
      ? sourceY + topHandleVisualOffset
      : sourcePosition === "bottom"
        ? sourceY + extensionDistance
        : sourceY;
  const extendedTargetX =
    targetPosition === "left"
      ? targetX - extensionDistance
      : targetPosition === "right"
        ? targetX + extensionDistance
        : targetX;
  const extendedTargetY =
    targetPosition === "top"
      ? targetY - extensionDistance
      : targetPosition === "bottom"
        ? targetY + extensionDistance
        : targetY;
  const getTargetHandleTailOffset = (position?: Position | null) => {
    const tailDistance = 12;

    switch (position) {
      case Position.Top:
        return { x: 0, y: -tailDistance };
      case Position.Right:
        return { x: tailDistance, y: 0 };
      case Position.Bottom:
        return { x: 0, y: tailDistance };
      case Position.Left:
        return { x: -tailDistance, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  };

  const targetTailOffset = getTargetHandleTailOffset(targetPosition);

  const adjustedTargetX = extendedTargetX + targetTailOffset.x;
  const adjustedTargetY = extendedTargetY + targetTailOffset.y;

  const {
    path: edgePath,
    midX,
    midY,
  } = calculateSmartPath(
    extendedSourceX,
    extendedSourceY,
    adjustedTargetX,
    adjustedTargetY,
    sourcePosition,
    targetPosition,
    nodes,
    source,
    target,
  );

  return (
    <g
      onMouseEnter={hover.onEdgeEnter}
      onMouseLeave={hover.onEdgeLeave}
      className="plug-edge p-2"
    >
      {/* Invisible wider path for better hover detection */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={EDGE_INTERACTION_WIDTH}
        className="react-flow__edge-interaction"
        fill="none"
        style={{
          pointerEvents: "stroke",
          strokeDasharray: "none",
          animation: "none",
        }}
      />
      <path
        id={id}
        d={edgePath}
        className={[
          "react-flow__edge-path",
          "plug-edge__cord",
          className || "",
          animated || agentActive ? "plug-edge__cord--animated" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        stroke={agentActive ? "#0891b2" : cordColor}
        strokeWidth={
          agentActive ? Math.max(EDGE_STROKE_WIDTH, strokeWidth) : strokeWidth
        }
        markerEnd={markerEnd}
        fill="none"
        style={{
          ...customStyle,
          // Inline styles outrank React Flow's edge-path CSS presentation rules.
          stroke: agentActive ? "#0891b2" : cordColor,
          strokeWidth: agentActive
            ? Math.max(EDGE_STROKE_WIDTH, strokeWidth)
            : strokeWidth,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          pointerEvents: "none",
        }}
      />
      <circle
        cx={extendedSourceX}
        cy={extendedSourceY}
        r={4}
        fill={cordColor}
        opacity={0.98}
      />
      <circle
        cx={adjustedTargetX}
        cy={adjustedTargetY}
        r={4}
        fill={cordColor}
        opacity={0.98}
      />
      {data?.label && (
        <text className="react-flow__edge-text">
          <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
            {String(data.label)}
          </textPath>
        </text>
      )}
      <EdgeToolbar
        edgeId={id}
        x={midX}
        y={midY}
        controls={computedControls}
        hover={hover}
      />
    </g>
  );
};

const getMalePlugRotation = (position?: Position | null): number => {
  switch (position) {
    case Position.Top:
      return -45; // face up
    case Position.Right:
      return 45; // face right
    case Position.Bottom:
      // Match bottom output handles: the plug prongs must point downward.
      return -45;
    case Position.Left:
      return -135; // face left
    default:
      return 45; // default face right
  }
};

const getMalePlugTailOffset = (position?: Position | null) => {
  const tailDistance = 10;

  switch (position) {
    case Position.Top:
      return { x: 0, y: tailDistance }; // plug faces up, tail is bottom
    case Position.Right:
      return { x: -tailDistance, y: 0 }; // plug faces right, tail is left
    case Position.Bottom:
      return { x: 0, y: -tailDistance }; // plug faces down, tail is top
    case Position.Left:
      return { x: tailDistance, y: 0 }; // plug faces left, tail is right
    default:
      return { x: -tailDistance, y: 0 };
  }
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
  const isDarkMode = useResolvedTheme() === "dark";
  const sourceNodeId = fromHandle?.nodeId;
  const sourceTheme = useSourceNodeTheme(sourceNodeId);

  const baseStroke =
    typeof style.stroke === "string"
      ? style.stroke
      : connectionStatus === "invalid"
        ? "#ef4444"
        : isDarkMode
          ? sourceTheme.edgeColor
          : "#9ca3af";

  const strokeWidth = readStrokeWidth(style.strokeWidth);

  const cordColor = connectionStatus === "invalid" ? "#ef4444" : baseStroke;
  const fromType = fromHandle?.type ?? "source";
  const draggingFromSource = fromType === "source";

  const plugPosition = draggingFromSource ? fromPosition : toPosition;

  const plugRotation = getMalePlugRotation(plugPosition);
  const plugTailOffset = getMalePlugTailOffset(plugPosition);

  const plugTailX = toX + plugTailOffset.x;
  const plugTailY = toY + plugTailOffset.y;

  // Use bezier path and connect it to the plug tail, not icon center
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: plugTailX,
    targetY: plugTailY,
    targetPosition: toPosition,
    // borderRadius: 10,
  });
  // const anchorX = draggingFromSource ? fromX : toX;
  // const anchorY = draggingFromSource ? fromY : toY;
  // const pointerX = draggingFromSource ? toX : fromX;
  // const pointerY = draggingFromSource ? toY : fromY;

  // const angle = Math.atan2(pointerY - anchorY, pointerX - anchorX);
  // const degrees = (angle * 180) / Math.PI;
  return (
    <g className="plug-edge plug-edge--connection">
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
      <g
        transform={`translate(${toX}, ${toY}) rotate(${plugRotation}) scale(0.9) translate(-12, -12)`}
        className="plug-edge__plug-dragging-inner"
      >
        <path
          d={MALE_PLUG_PATH}
          className="plug-edge__plug-path"
          fill={cordColor}
        />
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
}) => {
  const nodes = useEndpointBounds(source, target);
  const agentActive = useAgentEdgeActive(id, source, target, data);
  const endpointExpanded = useEdgeEndpointsExpanded(source, target);
  // Self-loops and return connections share bounds-aware routing and corner radius.
  const { path: pathD, midX, midY } = calculateSmartPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    nodes,
    source,
    target,
  );

  const editing = useContext(EdgeEditingContext);
  const canDelete = editing.deletableEdgeIds.has(id);
  const computedControls = (controls.length > 0 ? controls : buildControls(data, canDelete))
    .filter(control => control.action !== "delete" || canDelete);
  const hover = useEdgeToolbarHover(`${editing.sessionId}:${id}`, !endpointExpanded && editing.enabled && computedControls.length > 0, editing.canEdit, editing.sessionId);

  if (endpointExpanded) return null;

  return (
    <g onMouseEnter={hover.onEdgeEnter} onMouseLeave={hover.onEdgeLeave}>
      {/* Invisible wider path for better hover detection */}
      <path
        d={pathD}
        stroke="transparent"
        strokeWidth={EDGE_INTERACTION_WIDTH}
        className="react-flow__edge-interaction"
        fill="none"
        style={{
          pointerEvents: "stroke",
          strokeDasharray: "none",
          animation: "none",
        }}
      />
      <path
        id={id}
        className="react-flow__edge-path"
        d={pathD}
        fill="none"
        style={{
          strokeWidth: EDGE_STROKE_WIDTH,
          ...style,
          ...(agentActive
            ? {
                stroke: "#0891b2",
                strokeWidth: Math.max(
                  EDGE_STROKE_WIDTH,
                  readStrokeWidth(style?.strokeWidth),
                ),
                strokeDasharray: "6 4",
              }
            : {}),
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
      <EdgeToolbar
        edgeId={id}
        x={midX}
        y={midY}
        controls={computedControls}
        hover={hover}
      />
    </g>
  );
};

// Generic Self-Loop Edge for any node
export const SelfLoopEdge: React.FC<EdgeProps> = (props) => {
  const { data, source, target } = props;
  const isDarkMode = useResolvedTheme() === "dark";

  // Only apply self-loop styling if it's actually a self-loop
  if (source !== target) {
    return <DefaultEdge {...props} />;
  }

  return (
    <InteractiveEdge
      {...props}
      style={{
        stroke: isDarkMode
          ? (data?.loopColor as string) || "#6366f1"
          : "#9ca3af",
        strokeWidth: EDGE_STROKE_WIDTH,
        strokeDasharray: "5,5",
        ...props.style,
      }}
      markerEnd={MarkerType.ArrowClosed}
      data={data}
    />
  );
};

// Default edge for regular connections
export const DefaultEdge: React.FC<EdgeProps> = (props) => {
  const { data } = props;
  return (
    <PlugEdge
      {...props}
      data={data}
      style={{ strokeWidth: EDGE_STROKE_WIDTH, ...props.style }}
    />
  );
};

// Keep LoopEdge for backward compatibility with existing Loop nodes
export const LoopEdge: React.FC<EdgeProps> = (props) => {
  const { data } = props;
  const isDarkMode = useResolvedTheme() === "dark";

  return (
    <InteractiveEdge
      {...props}
      style={{
        stroke: isDarkMode ? "#22c55e" : "#9ca3af",
        strokeWidth: EDGE_STROKE_WIDTH,
        ...props.style,
      }}
      markerEnd={MarkerType.ArrowClosed}
      data={data}
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
