/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X, CheckCircle, XCircle, Clock, Radio, Loader2, Square, Pause, Play, ChevronLeft, ChevronRight } from "lucide-react";
import { isStandardNodeOutput } from "@/types/nodeOutput";
import DraggableFieldsPanel from "./DraggableFieldsPanel";


// Props strongly typed, mirroring InputPanel
export type OutputPanelProps = {
  data: any;
  isExpanded: boolean;
  position?: "left" | "right";
  /** Whether the output is currently pinned */
  pinned?: boolean;
  /** Callback when the user saves edited data */
  onSave?: (data: any) => void;
  /** Callback when the pin/unpin button is toggled */
  onPinToggle?: () => void;
  /** Read-only mode (for execution view) - hides edit/pin buttons */
  readOnly?: boolean;
  /** Whether the node is in test listening mode */
  isTestListening?: boolean;
  /** Callback to stop test listening */
  onStopListening?: () => void;
  /** Whether the stream is paused (UI updates skipped) */
  isStreamPaused?: boolean;
  /** Whether there is an active stream cursor to step from */
  hasStreamCursor?: boolean;
  /** Whether a next step exists from the current cursor */
  canStepNext?: boolean;
  /** Whether a previous step exists from the current cursor */
  canStepPrevious?: boolean;
  /** Callback to toggle pause/resume */
  onTogglePause?: () => void;
  /** Callback to step to next stream event */
  onStepNext?: () => void;
  /** Callback to step to previous stream event */
  onStepPrevious?: () => void;
};

// Status badge component for StandardNodeOutput
const StatusBadge: React.FC<{ status: string; success: boolean }> = ({ status, success }) => {
  const statusConfig: Record<string, { icon: React.ReactNode; className: string }> = {
    success: { icon: <CheckCircle className="w-3 h-3" />, className: "bg-green-500/20 text-green-500" },
    error: { icon: <XCircle className="w-3 h-3" />, className: "bg-red-500/20 text-red-500" },
    pending: { icon: <Clock className="w-3 h-3" />, className: "bg-yellow-500/20 text-yellow-500" },
    running: { icon: <Loader2 className="w-3 h-3 animate-spin" />, className: "bg-blue-500/20 text-blue-500" },
    waiting: { icon: <Clock className="w-3 h-3" />, className: "bg-orange-500/20 text-orange-500" },
    streaming: { icon: <Radio className="w-3 h-3" />, className: "bg-purple-500/20 text-purple-500" },
    listening: { icon: <Radio className="w-3 h-3" />, className: "bg-cyan-500/20 text-cyan-500" },
  };

  const config = statusConfig[status] || statusConfig[success ? 'success' : 'error'];

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.className}`}>
      {config.icon}
      <span className="capitalize">{status}</span>
    </div>
  );
};

const createRenderData = () => {
  const renderData = (data: any, parentKey = ""): React.ReactNode => {
    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      return (
        <div className="text-sm text-muted-foreground italic text-center py-6">
          No output yet.
        </div>
      );
    }
    
    if (typeof data === "object" && data !== null) {
      return (
        <DraggableFieldsPanel
          data={data}
          parentKey={parentKey}
          onDragStart={() => {}}
          draggable={false}
        />
      );
    }
    
    return (
      <div className="flex items-center gap-2 p-3 bg-background rounded-md border border-border/30">
        <span className="text-xs font-semibold text-primary">value:</span>
        <span className="text-xs text-foreground break-words">{String(data)}</span>
      </div>
    );
  };
  
  return renderData;
};

const OutputPanel: React.FC<OutputPanelProps> = ({
  data = {},
  isExpanded,
  position = "right",
  pinned = false,
  onSave = () => {},
  onPinToggle = () => {},
  readOnly = false,
  isTestListening = false,
  onStopListening,
  isStreamPaused = false,
  hasStreamCursor = false,
  canStepNext = true,
  canStepPrevious = true,
  onTogglePause,
  onStepNext,
  onStepPrevious,
}) => {
  const [internalData, setInternalData] = useState<any>(data);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");

  // Sync internal state when upstream data changes, unless pinned
  useEffect(() => {
    if (!pinned) {
      setInternalData(data);
      setIsEditing(false);
    }
  }, [data, pinned]);

  const displayData = useMemo(() => {
    if (isStandardNodeOutput(internalData)) {
      return {
        success: internalData.success,
        status: internalData.status,
        ...(internalData.error !== undefined ? { error: internalData.error } : {}),
        ...(internalData.data !== undefined ? { data: internalData.data } : {}),
      };
    }
    return internalData;
  }, [internalData]);

  const renderData = useMemo(() => {
    return createRenderData();
  }, []);

  if (!isExpanded) return null;

  // Handlers
  const handleEdit = () => {
    // For editing, we need to be careful with large data
    try {
      const dataStr = JSON.stringify(internalData, null, 2);
      if (dataStr.length > 100000) {
        // Too large to edit safely
        setEditText('// Data too large to edit directly\n// Export to JSON file for editing');
      } else {
        setEditText(dataStr);
      }
      setIsEditing(true);
    } catch {
      setEditText('// Unable to serialize data for editing');
      setIsEditing(true);
    }
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editText);
      setInternalData(parsed);
      if (typeof onSave === "function") {
        onSave(parsed);
      }
      setIsEditing(false);
    } catch (error) {
      console.error("Invalid JSON:", error);
    }
  };

  const handleCancel = () => {
    setEditText("");
    setIsEditing(false);
  };

  // Determine if we should show the streaming footer
  const showStreamingFooter = isTestListening && onStopListening;

  return (
    <div
      onDoubleClick={(e) => e.stopPropagation()}
      className={`absolute ${
        position === "right"
          ? "left-full top-0 ml-2"
          : "right-full top-0 mr-2"
      } w-80 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden flex flex-col`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground text-sm tracking-tight">
            Output
          </span>
          {isStandardNodeOutput(internalData) && (
            <StatusBadge status={internalData.status} success={internalData.success} />
          )}
        </div>
        {/* Hide edit/pin buttons in readOnly mode */}
        {!readOnly && (
          <div className="flex items-center space-x-1">
            {!isEditing && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground hover:bg-muted h-7 w-7 p-0"
                onClick={handleEdit}
                title="Edit Output"
              >
                <Edit2 className="w-3 h-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`hover:bg-muted h-7 w-7 p-0 transition-colors ${
                pinned 
                  ? "text-primary hover:text-primary-glow" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={onPinToggle}
              title={pinned ? "Unpin Output" : "Pin Output"}
            >
              {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            </Button>
          </div>
        )}
      </div>
      
      {/* Main content area - scrollable, accounts for footer height when streaming */}
      <div className={`p-3 flex-1 overflow-auto ${showStreamingFooter ? 'pb-20' : ''}`}>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              className="w-full p-3 border border-border rounded-md font-mono text-xs bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
              rows={12}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              placeholder="Enter JSON data..."
            />
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCancel}
                className="h-7 px-3 text-xs"
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button 
                size="sm" 
                onClick={handleSave}
                className="h-7 px-3 text-xs bg-success hover:bg-success/90 text-success-foreground"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {isStandardNodeOutput(internalData) ? (
              <>
                {renderData(displayData, "")}
                {internalData.meta?.executionTime && (
                  <div className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                    Executed in {internalData.meta.executionTime}ms
                  </div>
                )}
              </>
            ) : (
              renderData(displayData, "")
            )}
          </div>
        )}
      </div>

      {/* Fixed streaming control footer - always visible while streaming */}
      {showStreamingFooter && (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-card border-t border-cyan-500/30 bg-gradient-to-t from-cyan-500/10 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-500">
              <Radio className={`w-3 h-3 ${isStreamPaused ? '' : 'animate-pulse'}`} />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onStepPrevious}
                disabled={!onStepPrevious || !hasStreamCursor || !canStepPrevious}
                className="h-6 w-6 p-0 border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10 disabled:opacity-50"
                title="Previous event"
              >
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onStepNext}
                disabled={!onStepNext || !hasStreamCursor || !canStepNext}
                className="h-6 w-6 p-0 border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10 disabled:opacity-50"
                title="Next event"
              >
                <ChevronRight className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onTogglePause}
                className="h-6 w-6 p-0 border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10"
                title={isStreamPaused ? "Resume stream" : "Pause stream"}
              >
                {isStreamPaused ? (
                  <Play className="w-3 h-3 fill-current" />
                ) : (
                  <Pause className="w-3 h-3" />
                )}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onStopListening}
                className="h-6 text-xs px-2"
              >
              <Square className="w-2 h-2 mr-1 fill-current" />
                Stop
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutputPanel;
