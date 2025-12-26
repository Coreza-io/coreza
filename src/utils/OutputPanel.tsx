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

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X, CheckCircle, XCircle, Clock, Radio, Loader2, Square } from "lucide-react";
import { isStandardNodeOutput, extractOutputData } from "@/types/nodeOutput";
import type { StandardNodeOutput } from "@/types/nodeOutput";


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

// Recursively render output data, modern UI with design system
const renderData = (data: any, parentKey = ""): React.ReactNode => {
  console.log("Payload:", data);
  
  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return (
      <div className="text-sm text-muted-foreground italic text-center py-6">
        No output yet.
      </div>
    );
  }
  
  if (typeof data === "object" && data !== null) {
    return (
      <div className="flex flex-col gap-2">
        {Object.entries(data).map(([key, value]) => {
          const fullKey = parentKey ? `${parentKey}.${key}` : key;
          const displayValue = value;
          
          return (
            <div
              key={fullKey}
              className="flex flex-col px-3 py-2 rounded-md bg-background hover:bg-muted/50 transition-colors border border-border/30"
            >
              <span className="text-xs font-semibold text-primary">{key}</span>
              <span className="text-xs text-foreground pl-2 mt-1">
                {displayValue === undefined ? (
                  <span className="text-muted-foreground">undefined</span>
                ) : displayValue === null ? (
                  <span className="text-muted-foreground">null</span>
                ) : typeof displayValue === "object" ? (
                  <span className="font-mono text-muted-foreground bg-muted/20 px-2 py-1 rounded text-xs">
                    {JSON.stringify(displayValue, null, 2)}
                  </span>
                ) : (
                  <span className="break-words">
                    {String(displayValue)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
  
  return (
    <div className="flex items-center gap-2 p-3 bg-background rounded-md border border-border/30">
      <span className="text-xs font-semibold text-primary">value:</span>
      <span className="text-xs text-foreground break-words">{String(data)}</span>
    </div>
  );
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

  if (!isExpanded) return null;

  // Handlers
  const handleEdit = () => {
    setEditText(JSON.stringify(internalData, null, 2));
    setIsEditing(true);
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
      // Could add toast notification here
    }
  };

  const handleCancel = () => {
    setEditText("");
    setIsEditing(false);
  };

  return (
    <div
      className={`absolute ${
        position === "right"
          ? "left-full top-0 ml-2"
          : "right-full top-0 mr-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden`}
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
      
      <div className="p-3 h-[calc(100%-42px)] overflow-auto">
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
            {/* Show Stop Listening button when in test listening mode */}
            {(isTestListening || internalData?.status === 'listening') && onStopListening && (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="flex items-center gap-2 text-cyan-500">
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span className="text-sm font-medium">Listening for stream data...</span>
                </div>
                {internalData?.filterSymbols?.length > 0 && (
                  <div className="text-xs text-muted-foreground text-center">
                    Symbols: {internalData.filterSymbols.join(', ')}
                  </div>
                )}
                {internalData?.subscriptionMode && (
                  <div className="text-xs text-muted-foreground text-center">
                    Mode: {internalData.subscriptionMode === 'global' ? 'All My Subscriptions' : 'Workflow Only'}
                  </div>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStopListening}
                  className="mt-2"
                >
                  <Square className="w-3 h-3 mr-2 fill-current" />
                  Stop Listening
                </Button>
              </div>
            )}
            
            {/* Regular output rendering */}
            {!(isTestListening || internalData?.status === 'listening') && (
              isStandardNodeOutput(internalData) ? (
                <>
                  {/* Render full output structure: success, status, data/error */}
                  {renderData({
                    success: internalData.success,
                    status: internalData.status,
                    ...(internalData.error !== undefined ? { error: internalData.error } : {}),
                    ...(internalData.data !== undefined ? { data: internalData.data } : {}),
                  }, "")}
                  {internalData.meta?.executionTime && (
                    <div className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                      Executed in {internalData.meta.executionTime}ms
                    </div>
                  )}
                </>
              ) : (
                renderData(internalData, "")
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;