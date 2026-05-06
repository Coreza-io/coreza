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

import React, { useState, useEffect, useRef, useContext } from "react";
import { ConnectionDragContext } from "@/contexts/ConnectionDragContext";
import InputPanel from "@/utils/InputPanel";
import OutputPanel from "@/utils/OutputPanel";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Edit2, Trash2, Loader2, Wrench } from "lucide-react";
import ElectricBorderSVG from "@/components/workflow/ElectricBorderSVG";
import {
  FemalePlugIcon,
  MalePlugIcon,
  ConnectedSwitchIcon,
} from "@/components/workflow/EdgeManager";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

interface NodeWrapperProps {
  nodeId: string | undefined;
  nodes: any[];
  edges: any[];
  selected?: boolean;
  inputPanelProps?: any; // props for InputPanel
  outputPanelProps?: any; // props for OutputPanel
  icon?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  handles?: HandleConfig[];
  nodeType?: string;
  category?: string;
  onDoubleClick?: (e: React.MouseEvent) => void;
  // Node name editing props
  isEditing?: boolean;
  editingName?: string;
  editInputRef?: React.RefObject<HTMLInputElement>;
  startEditing?: () => void;
  finishEditing?: (save?: boolean) => void;
  setEditingName?: (name: string) => void;
  // Electric border props
  electricBorder?: boolean;
  electricColor?: "cyan" | "orange" | "blue" | "purple" | "green";
  isExecuting?: boolean;
  isStreamingWaiting?: boolean;
  // Stream data received flash
  streamDataReceived?: boolean;
  // Read-only mode (for execution view)
  readOnly?: boolean;
  executionStatus?: "success" | "failed" | "pending" | "running" | "skipped";
  executionDuration?: number;
  itemCount?: number;
  // Tool mode toggle
  isTool?: boolean;
  onToggleTool?: () => void;
}

const NodeWrapper: React.FC<NodeWrapperProps> = ({
  nodeId,
  nodes,
  edges,
  selected,
  inputPanelProps = {},
  outputPanelProps = {},
  icon,
  label,
  children,
  minWidth = 340,
  minHeight = 340,
  handles = [],
  nodeType,
  category,
  onDoubleClick,
  // Node name editing props
  isEditing = false,
  editingName = "",
  editInputRef,
  startEditing,
  finishEditing,
  setEditingName,
  // Electric border props
  electricBorder = true,
  electricColor = "cyan",
  isExecuting = false,
  isStreamingWaiting = false,
  // Stream data received flash
  streamDataReceived = false,
  // Read-only mode props
  readOnly = false,
  executionStatus,
  executionDuration,
  itemCount,
  // Tool mode
  isTool = false,
  onToggleTool,
}) => {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed by default
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const prevStreamDataReceived = useRef(streamDataReceived);
  const resolvedTheme = useResolvedTheme();
  const isDarkMode = resolvedTheme === "dark";
  const dragSource = useContext(ConnectionDragContext);

  // Detect when stream data is received and trigger flash animation
  useEffect(() => {
    if (streamDataReceived && !prevStreamDataReceived.current) {
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 600);
      return () => clearTimeout(timer);
    }
    prevStreamDataReceived.current = streamDataReceived;
  }, [streamDataReceived]);

  // Access ReactFlow hooks once and gate usage for readOnly mode to keep hook order stable
  const reactFlowContext = useReactFlow();
  const setNodes = readOnly ? undefined : reactFlowContext.setNodes;
  const setEdges = readOnly ? undefined : reactFlowContext.setEdges;

  // Open delete confirmation dialog
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDeleteDialogOpen(true);
  };

  // Confirm and delete node
  const confirmDeleteNode = () => {
    if (!nodeId || !setNodes || !setEdges) return;

    // Remove the node
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));

    // Remove all edges connected to this node
    setEdges((eds) =>
      eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
    );

    // Close dialog
    setIsDeleteDialogOpen(false);
  };

  // Map category to gradient class name
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

  const categoryGradientClass = getCategoryGradientClass(category);

  const streamingClasses = isStreamingWaiting
    ? "border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] animate-pulse"
    : "";

  // Execution status styling
  const getExecutionStatusClass = () => {
    if (!readOnly || !executionStatus) return "";
    switch (executionStatus) {
      case "success":
        return "ring-2 ring-emerald-500/50";
      case "failed":
        return "ring-2 ring-destructive/50";
      case "running":
        return "ring-2 ring-primary/50 animate-pulse";
      default:
        return "";
    }
  };

  // Merge in exactly what was passed, plus our own flags
  const mergedInputPanelProps = {
    nodeId,
    nodes,
    edges,
    isExpanded,
    readOnly,
    ...inputPanelProps,
  };
  const mergedOutputPanelProps = {
    isExpanded,
    readOnly,
    ...outputPanelProps,
  };

  const shapeStyles: Record<string, string> = {
    support: "rounded-full",
    agent: "rounded-lg",
    default: "rounded-lg",
  };
  const nodeShapeClass = shapeStyles[nodeType ?? "default"];
  const shouldShowHandlesOutside = handles.length > 0;

  return (
    <div className={`relative ${isExpanded ? "node-expanded" : ""}`}>
      {/* Input Data Panel */}
      <InputPanel {...mergedInputPanelProps} />

      {/* Main Node Card */}
      <Card
        className={`
          relative shadow-card transition-all duration-300 ease-in-out 
          border-2 hover:shadow-elevated
          ${isExpanded ? "" : "w-[150px] h-[100px] cursor-pointer group"}
          ${nodeShapeClass}
          ${isFlashing ? "animate-stream-data-flash" : ""}
          ${
            isExecuting && electricBorder && isDarkMode
              ? `electric-border electric-border-${electricColor} border-transparent`
              : selected
              ? "border-primary shadow-glow"
              : "border-border"
          }
          ${streamingClasses}
          ${getExecutionStatusClass()}
          ${
            isDarkMode && categoryGradientClass
              ? //!isExpanded && isDarkMode && categoryGradientClass
                categoryGradientClass
              : "bg-card"
          }
        `}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsExpanded(true);
          if (onDoubleClick) {
            onDoubleClick(e);
          }
        }}
        style={{
          width: isExpanded ? minWidth : 200,
          minHeight: isExpanded ? minHeight : 150,
          height: isExpanded ? "auto" : 150,
          overflow:
            shouldShowHandlesOutside ||
            (electricBorder && isExecuting && isDarkMode)
              ? "visible"
              : "hidden",
        }}
      >
        {/* Electric Border SVG Overlay */}
        {!isExpanded && electricBorder && isExecuting && isDarkMode && (
          <ElectricBorderSVG
            isExpanded={isExpanded}
            color={
              electricColor === "cyan"
                ? "#00ffff"
                : electricColor === "orange"
                ? "#ff8c00"
                : electricColor === "blue"
                ? "#3b82f6"
                : electricColor === "purple"
                ? "#a855f7"
                : "#00ff00"
            }
          />
        )}
        {/* Handles (configured in manifest) - Always render for React Flow connections */}
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

            // Check if this handle is connected
            const isConnected = edges.some((edge) => {
              if (isInputHandle) {
                // For input handles, check if this node is a target
                return edge.target === nodeId && edge.targetHandle === h.id;
              } else {
                // For output handles, check if this node is a source
                return edge.source === nodeId && edge.sourceHandle === h.id;
              }
            });

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

            // Determine which icon to show - same logic for editor and execution view
            let handleIcon = null;
            if (isInputHandle) {
              // For input handles: show ConnectedSwitchIcon if connected, otherwise FemalePlugIcon
              handleIcon = isConnected ? (
                <ConnectedSwitchIcon size={20} style={iconStyle} />
              ) : (
                <FemalePlugIcon size={20} style={iconStyle} />
              );
            } else {
              // For output handles: hide icon if connected or currently dragging from this handle
              const isDraggingFromThis =
                dragSource.handleType === "source" &&
                dragSource.nodeId === nodeId &&
                dragSource.handleId === h.id;
              handleIcon = (isConnected || isDraggingFromThis) ? null : (
                <MalePlugIcon size={20} style={iconStyle} />
              );
            }

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

        {/* Collapsed View */}
        {!isExpanded && (
          <div className="flex flex-col items-center justify-center h-full p-4 select-none relative group">
            {/* Execution status badge - only in readOnly mode */}
            {readOnly && executionStatus && (
              <div className="absolute top-1 left-1 z-10">
                {executionStatus === "success" && (
                  <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </div>
                )}
                {executionStatus === "failed" && (
                  <div className="h-5 w-5 rounded-full bg-destructive/20 flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-destructive" />
                  </div>
                )}
                {executionStatus === "running" && (
                  <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center">
                    <Loader2 className="h-3 w-3 text-primary animate-spin" />
                  </div>
                )}
                {executionStatus === "pending" && (
                  <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />
                  </div>
                )}
              </div>
            )}
            {/* Execution duration - only in readOnly mode */}
            {readOnly &&
              executionDuration !== undefined &&
              executionDuration > 0 && (
                <div className="absolute top-1 right-1 z-10 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                  {executionDuration < 1000
                    ? `${executionDuration}ms`
                    : `${(executionDuration / 1000).toFixed(1)}s`}
                </div>
              )}
            {/* Delete button - appears on hover when selected (NOT in readOnly mode) */}
            {!readOnly && selected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteClick}
                title="Delete node"
                className="absolute top-1 right-1 z-10 h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3 w-3 text-red-500" />
              </Button>
            )}
            <div className="text-muted-foreground mb-2">
              {/* Render icon with immediate loading */}
              {typeof icon === "string" && icon.startsWith("/assets/") ? (
                <img
                  src={icon}
                  alt="Node icon"
                  className="w-6 h-6"
                  loading="eager"
                  style={{ imageRendering: "auto" }}
                />
              ) : (
                icon
              )}
            </div>
            <div className="font-semibold text-sm text-foreground text-center leading-tight">
              {isEditing && selected && !readOnly ? (
                <Input
                  ref={editInputRef}
                  value={editingName}
                  onChange={(e) => setEditingName?.(e.target.value)}
                  onBlur={(e) => {
                    // Prevent blur from canceling edit if clicking on edit controls
                    const relatedTarget = e.relatedTarget as HTMLElement;
                    if (
                      !relatedTarget ||
                      !relatedTarget.closest(".node-edit-controls")
                    ) {
                      finishEditing?.(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation(); // Prevent parent handlers
                    if (e.key === "Enter") {
                      e.preventDefault();
                      finishEditing?.(true);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      finishEditing?.(false);
                    }
                  }}
                  className="h-6 text-xs text-center px-1 nodrag bg-background border border-primary/50 focus:border-primary"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div
                  className={`flex items-center justify-center gap-1 ${
                    !readOnly ? "cursor-pointer" : ""
                  } group relative`}
                  onDoubleClick={(e) => {
                    if (readOnly) return;
                    e.stopPropagation();
                    startEditing?.();
                  }}
                  title={
                    !readOnly && selected
                      ? "Press F2 or double-click to rename"
                      : ""
                  }
                >
                  {label}
                  {!readOnly && selected && startEditing && (
                    <Edit2 className="w-3 h-3 opacity-30 group-hover:opacity-60 transition-opacity" />
                  )}
                </div>
              )}
            </div>
            {/* Item count badge - only in readOnly mode */}
            {readOnly && itemCount !== undefined && itemCount > 0 && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                {itemCount} item{itemCount !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}

        {/* Expanded View */}
        {isExpanded && (
          <CardContent className="space-y-3 p-4">
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              {/* <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteClick}
                title="Delete node"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-6 w-6 p-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button> */}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                title="Collapse"
                className="text-muted-foreground hover:text-foreground hover:bg-muted h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {children}
          </CardContent>
        )}
      </Card>

      {/* Output Data Panel */}
      <OutputPanel {...mergedOutputPanelProps} />

      {/* Delete Confirmation Dialog - only in editor mode */}
      {!readOnly && (
        <AlertDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
        >
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Node</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{label}"? This action cannot be
                undone. All connections to this node will also be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteNode}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete Node
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

export default NodeWrapper;
