import React, { useState } from "react";
import InputPanel from "@/utils/InputPanel";
import OutputPanel from "@/utils/OutputPanel";
import { Handle, Position } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Edit2 } from "lucide-react";

const POSITION_MAP: Record<"left" | "right" | "top" | "bottom", Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

interface HandleConfig {
  id: string;
  type: "source" | "target";
  position: "left" | "right" | "top" | "bottom";
}

interface NodeWrapperProps {
  nodeId: string | undefined;
  nodes: any[];
  edges: any[];
  selected?: boolean;
  inputPanelProps?: any;   // props for InputPanel
  outputPanelProps?: any;  // props for OutputPanel
  icon?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
  minWidth?: number;
  minHeight?: number;
  handles?: HandleConfig[];
  nodeType?: string;
  onDoubleClick?: (e: React.MouseEvent) => void;
  // Node name editing props
  isEditing?: boolean;
  editingName?: string;
  editInputRef?: React.RefObject<HTMLInputElement>;
  startEditing?: () => void;
  finishEditing?: (save?: boolean) => void;
  setEditingName?: (name: string) => void;
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
  onDoubleClick,
  // Node name editing props
  isEditing = false,
  editingName = '',
  editInputRef,
  startEditing,
  finishEditing,
  setEditingName,
}) => {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed by default

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

  return (
    <div className="relative">
      {/* Input Data Panel */}
      <InputPanel {...mergedInputPanelProps} />

      {/* Main Node Card */}
      <Card
        className={`
          relative shadow-card overflow-hidden transition-all duration-300 ease-in-out 
          bg-card border-2 hover:shadow-elevated
          ${isExpanded ? "" : "w-[150px] h-[100px] cursor-pointer group"}
          ${nodeShapeClass}
          ${selected ? "border-primary shadow-glow" : "border-border"}
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
          width: isExpanded ? minWidth : 150,
          minHeight: isExpanded ? minHeight : 100,
          height: isExpanded ? "auto" : 100,
        }}
      >
        {/* Handles (configured in manifest) - Always render for React Flow connections */}
        {(["top", "bottom", "left", "right"] as const).map((pos) => {
          const group = handles.filter((h) => h.position === pos);
          const isHorizontal = pos === "top" || pos === "bottom";
          return group.map((h, idx) => {
            const pct = ((idx + 1) / (group.length + 1)) * 100;
            const style = isHorizontal ? { left: `${pct}%` } : { top: `${pct}%` };
            return (
              <Handle
                key={h.id}
                id={h.id}
                type={h.type}
                position={POSITION_MAP[h.position]}
                style={style}
                className="w-3 h-3 border-2 border-gray-600 bg-gray-500 hover:border-primary transition-colors"
              />
            );
          });
        })}

        {/* Collapsed View */}
        {!isExpanded && (
          <div className="flex flex-col items-center justify-center h-full p-4 select-none">
            <div className="text-muted-foreground mb-2">
              {/* Render icon with immediate loading */}
              {typeof icon === 'string' && icon.startsWith('/assets/') ? (
                <img 
                  src={icon} 
                  alt="Node icon" 
                  className="w-6 h-6" 
                  loading="eager"
                  style={{ imageRendering: 'auto' }}
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
                  onBlur={() => finishEditing?.(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      finishEditing?.(true);
                    } else if (e.key === 'Escape') {
                      finishEditing?.(false);
                    }
                  }}
                  className="h-6 text-xs text-center px-1 nodrag"
                  autoFocus
                />
              ) : (
                <div 
                  className="flex items-center justify-center gap-1 cursor-pointer group" 
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
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(false);
              }}
              title="Collapse"
              className="text-muted-foreground hover:text-foreground hover:bg-muted absolute top-2 right-2 z-10 h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
            {children}
          </CardContent>
        )}
      </Card>

      {/* Output Data Panel */}
      <OutputPanel {...mergedOutputPanelProps} />
    </div>
  );
};

export default NodeWrapper;