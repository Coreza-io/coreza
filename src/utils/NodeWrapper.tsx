import React, { useState } from "react";
import InputPanel from "@/utils/InputPanel";
import OutputPanel from "@/utils/OutputPanel";
import { Handle, Position } from "@xyflow/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
}) => {
  const [isExpanded, setIsExpanded] = useState(false); // Start collapsed by default
  const [isFullscreen, setIsFullscreen] = useState(false); // Fullscreen modal state

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
    <>
      <div className="relative">
        {/* Input Data Panel */}
        <InputPanel {...mergedInputPanelProps} />

        {/* Main Node Card - Always collapsed when not in fullscreen */}
        <Card
          className={`
            relative shadow-card overflow-hidden transition-all duration-300 ease-in-out 
            bg-card border-2 hover:shadow-elevated w-[150px] h-[100px] cursor-pointer group
            ${nodeShapeClass}
            ${selected ? "border-primary shadow-glow" : "border-border"}
          `}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsFullscreen(true);
          }}
        >
          {/* Handles (configured in manifest) */}
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
                  className="w-3 h-3 border-2 border-border bg-background hover:border-primary transition-colors"
                />
              );
            });
          })}

          {/* Always show collapsed view */}
          <div className="flex flex-col items-center justify-center h-full p-4 select-none">
            <div className="text-muted-foreground mb-2">
              {icon}
            </div>
            <div className="font-semibold text-sm text-foreground text-center leading-tight">
              {label}
            </div>
          </div>
        </Card>

        {/* Output Data Panel */}
        <OutputPanel {...mergedOutputPanelProps} />
      </div>

      {/* Fullscreen Modal */}
      <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
        <DialogContent 
          className="max-w-none w-screen h-screen m-0 rounded-none p-6 overflow-auto"
          style={{
            userSelect: 'auto',
            WebkitUserSelect: 'auto',
            pointerEvents: 'auto'
          }}
        >
          <div className="w-full h-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                {icon}
                {label}
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsFullscreen(false)}
                title="Close"
                className="text-muted-foreground hover:text-foreground hover:bg-muted h-8 w-8 p-0"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="h-full">
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default NodeWrapper;