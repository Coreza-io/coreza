/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { CheckCircle2, XCircle, Clock, Loader2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import CachedIcon from "@/components/common/CachedIcon";

interface ExecutionNodeData {
  definition?: {
    name?: string;
    icon?: string;
    color?: string;
    category?: string;
    handles?: { type: string; position: string; id: string }[];
  };
  displayName?: string;
  label?: string;
  executionStatus?: "success" | "failed" | "pending" | "running" | "skipped";
  executionDuration?: number;
  itemCount?: number;
  hasError?: boolean;
  errorMessage?: string;
}

const categoryGradients: Record<string, string> = {
  broker: "from-blue-500/20 to-blue-600/10",
  indicator: "from-purple-500/20 to-purple-600/10",
  data: "from-green-500/20 to-green-600/10",
  control: "from-orange-500/20 to-orange-600/10",
  communication: "from-pink-500/20 to-pink-600/10",
  ai: "from-cyan-500/20 to-cyan-600/10",
  storage: "from-amber-500/20 to-amber-600/10",
  trigger: "from-rose-500/20 to-rose-600/10",
  default: "from-muted/50 to-muted/30",
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    case "skipped":
      return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
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

const formatDuration = (ms: number | undefined): string => {
  if (!ms || ms === 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

interface ExecutionNodeProps {
  data: ExecutionNodeData;
}

const ExecutionNodeRenderer: React.FC<ExecutionNodeProps> = ({ data }) => {
  const definition = data?.definition;
  const displayName = data?.displayName || definition?.name || data?.label || "Node";
  const icon = definition?.icon;
  const color = definition?.color || "#6b7280";
  const category = definition?.category || "default";
  const handles = definition?.handles || [
    { type: "target", position: "left", id: "input" },
    { type: "source", position: "right", id: "output" },
  ];

  const status = data?.executionStatus || "pending";
  const duration = data?.executionDuration;
  const itemCount = data?.itemCount || 0;
  const hasError = data?.hasError;
  const errorMessage = data?.errorMessage;

  const gradient = categoryGradients[category] || categoryGradients.default;

  return (
    <div
      className={cn(
        "relative rounded-lg border bg-gradient-to-br shadow-sm min-w-[180px] max-w-[220px]",
        gradient,
        status === "success" && "border-success/50",
        status === "failed" && "border-destructive/50",
        status === "running" && "border-primary/50 animate-pulse",
        status === "pending" && "border-border/50 opacity-60",
        status === "skipped" && "border-warning/50 opacity-70"
      )}
      style={{
        borderLeftColor: color,
        borderLeftWidth: "3px",
      }}
    >
      {/* Handles */}
      {handles.map((handle) => (
        <Handle
          key={handle.id}
          type={handle.type as "source" | "target"}
          position={handle.position as Position}
          id={handle.id}
          className={cn(
            "!w-2.5 !h-2.5 !border-2 !border-background",
            handle.type === "source" ? "!bg-primary" : "!bg-muted-foreground"
          )}
        />
      ))}

      {/* Node Content */}
      <div className="px-3 py-2.5">
        {/* Header: Icon + Name */}
        <div className="flex items-center gap-2 mb-2">
          {icon && (
            <div
              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center"
              style={{ backgroundColor: `${color}20` }}
            >
              <CachedIcon
                src={icon}
                alt={displayName}
                className="w-4 h-4"
              />
            </div>
          )}
          <span className="font-medium text-sm text-foreground truncate flex-1">
            {displayName}
          </span>
        </div>

        {/* Status Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant={getStatusBadgeVariant(status)} 
            className="text-xs px-1.5 py-0 h-5 gap-1"
          >
            {getStatusIcon(status)}
            <span className="capitalize">{status}</span>
          </Badge>

          {duration !== undefined && duration > 0 && (
            <span className="text-xs text-muted-foreground">
              {formatDuration(duration)}
            </span>
          )}

          {itemCount > 0 && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Error Message */}
        {hasError && errorMessage && (
          <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded px-2 py-1 truncate" title={errorMessage}>
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(ExecutionNodeRenderer);
