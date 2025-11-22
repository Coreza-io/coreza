import React, { useState } from "react";
import InputPanel from "@/utils/InputPanel";
import OutputPanel from "@/utils/OutputPanel";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Edit2, Trash2 } from "lucide-react";
import ElectricBorderSVG from "@/components/workflow/ElectricBorderSVG";
import {
  FemalePlugIcon,
  MalePlugIcon,
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
  left: "translate(-50%, -50%)",
  right: "translate(150%, -50%)",
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed by default
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const resolvedTheme = useResolvedTheme();
  const isDarkMode = resolvedTheme === "dark";
  const { setNodes, setEdges } = useReactFlow();

  // Open delete confirmation dialog
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDeleteDialogOpen(true);
  };

  // Confirm and delete node
  const confirmDeleteNode = () => {
    if (!nodeId) return;

    // Remove the node
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    
    // Remove all edges connected to this node
    setEdges((eds) =>
      eds.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      )
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

  // Merge in exactly what was passed, plus our own flags
  const mergedInputPanelProps = {
    nodeId,
    nodes,
    edges,
    isExpanded,
    ...inputPanelProps,
  };
  const mergedOutputPanelProps = {
    isExpanded,
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
    <div className="relative">
      {/* Input Data Panel */}
      <InputPanel {...mergedInputPanelProps} />

      {/* Main Node Card */}
      <Card
        className={`
          relative shadow-card transition-all duration-300 ease-in-out 
          border-2 hover:shadow-elevated
          ${isExpanded ? "" : "w-[150px] h-[100px] cursor-pointer group"}
          ${nodeShapeClass}
          ${
            isExecuting && electricBorder && isDarkMode
              ? `electric-border electric-border-${electricColor} border-transparent`
              : selected
              ? "border-primary shadow-glow"
              : "border-border"
          }
          ${
            isDarkMode && categoryGradientClass
              ? categoryGradientClass
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
                {isInputHandle ? (
                  <FemalePlugIcon size={20} style={iconStyle} />
                ) : (
                  <MalePlugIcon size={20} style={iconStyle} />
                )}
              </Handle>
            );
          });
        })}

        {/* Collapsed View */}
        {!isExpanded && (
          <div className="flex flex-col items-center justify-center h-full p-4 select-none relative group">
            {/* Delete button - appears on hover when selected */}
            {selected && (
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
              {isEditing && selected ? (
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
                  className="flex items-center justify-center gap-1 cursor-pointer group relative"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEditing?.();
                  }}
                  title={selected ? "Press F2 or double-click to rename" : ""}
                >
                  {label}
                  {selected && startEditing && (
                    <Edit2 className="w-3 h-3 opacity-30 group-hover:opacity-60 transition-opacity" />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Expanded View */}
        {isExpanded && (
          <CardContent className="space-y-3 p-4">
            <div className="absolute top-2 right-2 z-10 flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteClick}
                title="Delete node"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-6 w-6 p-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Node</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{label}"? This action cannot be undone.
              All connections to this node will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setIsDeleteDialogOpen(false)}
            >
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
    </div>
  );
};

export default NodeWrapper;
