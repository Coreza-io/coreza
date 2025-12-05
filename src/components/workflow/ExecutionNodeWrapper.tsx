/*
 * Copyright (C) 2024 Coreza
 * Read-only node wrapper for execution history view
 * Matches editor NodeWrapper styling exactly
 */

import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import {
  FemalePlugIcon,
  MalePlugIcon,
  ConnectedSwitchIcon,
} from "@/components/workflow/EdgeManager";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

type HandlePosition = "left" | "right" | "top" | "bottom";

const POSITION_MAP: Record<HandlePosition, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

const ROTATION_MAP: Record<HandlePosition, number> = {
  left: 45,
  right: 45,
  top: -45,
  bottom: -45,
};

const HANDLE_TRANSFORM_MAP: Record<HandlePosition, string> = {
  left: "translate(-55%, -50%)",
  right: "translate(110%, -50%)",
  top: "translate(-50%, -150%)",
  bottom: "translate(-50%, 50%)",
};

const ICON_TRANSLATION_MAP: Record<HandlePosition, string> = {
  left: "translate(-2px, 0)",
  right: "translate(2px, 0)",
  top: "translate(0, -2px)",
  bottom: "translate(0, 2px)",
};

interface HandleConfig {
  id: string;
  type?: "source" | "target" | "input" | "output";
  position: "left" | "right" | "top" | "bottom";
}

interface ExecutionNodeWrapperProps {
  id: string;
  data: {
    definition?: {
      icon?: string;
      category?: string;
      handles?: HandleConfig[];
    };
    displayName?: string;
    label?: string;
    executionStatus?: "success" | "failed" | "pending" | "running" | "skipped";
    executionDuration?: number;
    itemCount?: number;
    hasError?: boolean;
    errorMessage?: string;
  };
  selected?: boolean;
}

// Map category to gradient class name (same as NodeWrapper)
const getCategoryGradientClass = (category?: string): string => {
  if (!category) return "";

  const normalizedCategory = category.toLowerCase().replace(/\s+/g, "");

  const categoryMap: Record<string, string> = {
    indicators: "bg-gradient-indicators",
    broker: "bg-gradient-broker",
    data: "bg-gradient-data",
    logic: "bg-gradient-logic",
    screener: "bg-gradient-screener",
    input: "bg-gradient-input",
    visualization: "bg-gradient-visualization",
    llm: "bg-gradient-llm",
    chatmodel: "bg-gradient-chatmodel",
    aiagent: "bg-gradient-aiagent",
    email: "bg-gradient-email",
    tool: "bg-gradient-tool",
    riskmanagement: "bg-gradient-risk",
    scheduler: "bg-gradient-scheduler",
  };

  return categoryMap[normalizedCategory] || "";
};

const getStatusIcon = (status?: string) => {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    case "skipped":
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const getStatusBadgeVariant = (status?: string): "default" | "destructive" | "secondary" | "outline" => {
  switch (status) {
    case "success":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
};

const formatDuration = (ms?: number): string => {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const ExecutionNodeWrapper: React.FC<ExecutionNodeWrapperProps> = ({
  id,
  data,
  selected,
}) => {
  const resolvedTheme = useResolvedTheme();
  const isDarkMode = resolvedTheme === "dark";

  const {
    definition,
    displayName,
    label,
    executionStatus = "pending",
    executionDuration,
    itemCount,
    hasError,
    errorMessage,
  } = data;

  const icon = definition?.icon;
  const category = definition?.category;
  const handles = definition?.handles || [];
  const nodeLabel = displayName || label || "Node";

  const categoryGradientClass = getCategoryGradientClass(category);

  // Status-based border color
  const statusBorderClass =
    executionStatus === "success"
      ? "border-emerald-500/50"
      : executionStatus === "failed"
      ? "border-destructive/50"
      : executionStatus === "running"
      ? "border-primary/50"
      : "border-border";

  return (
    <div className="relative">
      <Card
        className={`
          relative shadow-card transition-all duration-300 ease-in-out 
          border-2 w-[150px] h-[100px] rounded-lg
          ${selected ? "border-primary shadow-glow" : statusBorderClass}
          ${isDarkMode && categoryGradientClass ? categoryGradientClass : "bg-card"}
        `}
        style={{
          width: 200,
          minHeight: 150,
          height: 150,
          overflow: "visible",
        }}
      >
        {/* Handles - same as NodeWrapper */}
        {(["top", "bottom", "left", "right"] as const).map((pos) => {
          const group = handles.filter((h) => h.position === pos);
          const isHorizontal = pos === "top" || pos === "bottom";
          return group.map((h, idx) => {
            const pct = ((idx + 1) / (group.length + 1)) * 100;
            const style = isHorizontal
              ? { left: `${pct}%` }
              : { top: `${pct}%` };
            const rawType = typeof h.type === "string" ? h.type : "source";
            const normalizedType = rawType.toLowerCase();
            const isInputHandle =
              normalizedType === "target" || normalizedType === "input";

            const orientationClass = `plug-handle--${pos}`;
            const handleClass = `plug-handle ${orientationClass} ${
              isInputHandle ? "plug-handle--female" : "plug-handle--male"
            }`;
            const handleTransform = HANDLE_TRANSFORM_MAP[pos];
            const rotation = ROTATION_MAP[pos];
            const iconTranslation = ICON_TRANSLATION_MAP[pos];
            const iconStyle = {
              transform: `${iconTranslation} rotate(${rotation}deg)`,
            };

            // Show connected icon for all handles in execution view
            const handleIcon = isInputHandle ? (
              <ConnectedSwitchIcon size={20} style={iconStyle} />
            ) : (
              <MalePlugIcon size={20} style={iconStyle} />
            );

            return (
              <Handle
                key={h.id}
                id={h.id}
                type={normalizedType === "target" ? "target" : "source"}
                position={POSITION_MAP[h.position]}
                style={{
                  ...style,
                  width: 24,
                  height: 24,
                  transform: handleTransform,
                }}
                className={handleClass}
              >
                {handleIcon}
              </Handle>
            );
          });
        })}

        {/* Content - Collapsed View Only (Read-only) */}
        <div className="flex flex-col items-center justify-center h-full p-4 select-none relative">
          {/* Status Badge - Top Left */}
          <div className="absolute top-2 left-2">
            <Badge
              variant={getStatusBadgeVariant(executionStatus)}
              className="h-5 px-1.5 text-[10px] font-medium flex items-center gap-1"
            >
              {getStatusIcon(executionStatus)}
              <span className="capitalize">{executionStatus}</span>
            </Badge>
          </div>

          {/* Duration - Top Right */}
          {executionDuration !== undefined && executionDuration > 0 && (
            <div className="absolute top-2 right-2">
              <span className="text-[10px] text-muted-foreground font-mono">
                {formatDuration(executionDuration)}
              </span>
            </div>
          )}

          {/* Icon */}
          <div className="text-muted-foreground mb-2 mt-4">
            {typeof icon === "string" && icon.startsWith("/assets/") ? (
              <img
                src={icon}
                alt="Node icon"
                className="w-6 h-6"
                loading="eager"
                style={{ imageRendering: "auto" }}
              />
            ) : (
              <div className="w-6 h-6 bg-muted rounded flex items-center justify-center text-xs">
                N
              </div>
            )}
          </div>

          {/* Label */}
          <div className="font-semibold text-sm text-foreground text-center leading-tight">
            {nodeLabel}
          </div>

          {/* Item Count Badge - Bottom */}
          {itemCount !== undefined && itemCount > 0 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
              <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </Badge>
            </div>
          )}

          {/* Error indicator */}
          {hasError && (
            <div className="absolute bottom-2 right-2" title={errorMessage}>
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ExecutionNodeWrapper;
