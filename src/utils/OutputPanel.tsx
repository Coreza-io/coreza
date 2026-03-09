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

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X, CheckCircle, XCircle, Clock, Radio, Loader2, Square, ChevronDown, ChevronRight, BarChart3, List, Pause, Play } from "lucide-react";
import { isStandardNodeOutput } from "@/types/nodeOutput";
import type { StandardNodeOutput } from "@/types/nodeOutput";
import { truncateForDisplay } from "./outputTruncation";
import { VirtualizedArrayBrowser } from "@/components/workflow/VirtualizedArrayBrowser";


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
  /** Callback to toggle pause/resume */
  onTogglePause?: () => void;
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

// Special component for bars data summary
const BarsDataSummary: React.FC<{ 
  stats: { count: number; dateRange: string; priceRange: string }; 
  preview: any[];
  fullData?: any[];
  onBrowse?: (data: any[], title: string) => void;
}> = ({ stats, preview, fullData, onBrowse }) => {
  const [showPreview, setShowPreview] = useState(false);
  
  return (
    <div className="bg-muted/30 rounded-md border border-border/30 overflow-hidden">
      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary">
            <BarChart3 className="w-3 h-3" />
            <span className="text-xs font-semibold">Bars Data</span>
          </div>
          {fullData && onBrowse && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-5 text-[10px] px-2"
              onClick={() => onBrowse(fullData, 'bars')}
            >
              <List className="w-3 h-3 mr-1" />
              Browse
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Count:</span>
          <span className="font-mono">{stats.count.toLocaleString()}</span>
          <span className="text-muted-foreground">Range:</span>
          <span className="font-mono text-[10px]">{stats.dateRange}</span>
          <span className="text-muted-foreground">Price:</span>
          <span className="font-mono">{stats.priceRange}</span>
        </div>
      </div>
      
      <button
        onClick={() => setShowPreview(!showPreview)}
        className="w-full flex items-center justify-between px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 border-t border-border/30"
      >
        <span>Preview first 3 bars</span>
        {showPreview ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      
      {showPreview && preview && (
        <div className="p-2 border-t border-border/30 bg-background/50 max-h-32 overflow-auto">
          {preview.map((bar, i) => (
            <div key={i} className="text-[10px] font-mono text-muted-foreground truncate">
              {JSON.stringify(bar)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Truncated array display component
const TruncatedArrayDisplay: React.FC<{ 
  total: number; 
  preview: any[]; 
  parentKey: string;
  fullData?: any[];
  onBrowse?: (data: any[], title: string) => void;
}> = ({ total, preview, parentKey, fullData, onBrowse }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="rounded-md border border-border/30 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors"
      >
        <span className="text-xs font-semibold text-primary">{parentKey || 'Array'}</span>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          {total.toLocaleString()} items
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      </button>
      
      {expanded && (
        <div className="p-2 space-y-1">
          <div className="max-h-32 overflow-auto space-y-1">
            {preview.map((item, i) => (
              <div key={i} className="text-[10px] font-mono text-foreground bg-background p-1 rounded truncate">
                [{i}] {typeof item === 'object' ? JSON.stringify(item) : String(item)}
              </div>
            ))}
          </div>
          {total > preview.length && (
            <div className="flex items-center justify-between pt-2 border-t border-border/20">
              <span className="text-[10px] text-muted-foreground italic">
                ...and {(total - preview.length).toLocaleString()} more
              </span>
              {fullData && onBrowse && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-5 text-[10px] px-2"
                  onClick={() => onBrowse(fullData, parentKey || 'Array')}
                >
                  <List className="w-3 h-3 mr-1" />
                  Browse All
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper to get original array from data structure by key path
const getOriginalArrayByPath = (data: any, path: string): any[] | null => {
  if (!data || !path) return null;
  const parts = path.split('.');
  let current = data;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return Array.isArray(current) ? current : null;
};

// Recursively render output data with truncation support
const createRenderData = (
  originalData: any,
  onBrowse?: (data: any[], title: string) => void
) => {
  const renderData = (data: any, parentKey = ""): React.ReactNode => {
    // Handle truncated bars data
    if (data?.__truncated && data.__type === 'bars' && data.__stats) {
      const fullData = parentKey ? getOriginalArrayByPath(originalData, parentKey) : null;
      return (
        <BarsDataSummary 
          stats={data.__stats} 
          preview={data.__preview || []} 
          fullData={fullData ?? undefined}
          onBrowse={onBrowse}
        />
      );
    }
    
    // Handle truncated arrays
    if (data?.__truncated && data.__type === 'array') {
      const fullData = parentKey ? getOriginalArrayByPath(originalData, parentKey) : null;
      return (
        <TruncatedArrayDisplay 
          total={data.__total} 
          preview={data.__preview || []} 
          parentKey={parentKey}
          fullData={fullData ?? undefined}
          onBrowse={onBrowse}
        />
      );
    }
    
    if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
      return (
        <div className="text-sm text-muted-foreground italic text-center py-6">
          No output yet.
        </div>
      );
    }
    
    if (typeof data === "object" && data !== null) {
      // Filter out internal truncation metadata
      const entries = Object.entries(data).filter(([key]) => !key.startsWith('__'));
      
      return (
        <div className="flex flex-col gap-2">
          {entries.map(([key, value]) => {
            const fullKey = parentKey ? `${parentKey}.${key}` : key;
            
            // Check if value is a truncated structure
            const valueObj = value as any;
            if (valueObj?.__truncated) {
              return (
                <div key={fullKey} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-primary px-1">{key}</span>
                  {renderData(value, fullKey)}
                </div>
              );
            }
            
            return (
              <div
                key={fullKey}
                className="flex flex-col px-3 py-2 rounded-md bg-background hover:bg-muted/50 transition-colors border border-border/30"
              >
                <span className="text-xs font-semibold text-primary">{key}</span>
                <span className="text-xs text-foreground pl-2 mt-1">
                  {value === undefined ? (
                    <span className="text-muted-foreground">undefined</span>
                  ) : value === null ? (
                    <span className="text-muted-foreground">null</span>
                  ) : typeof value === "object" ? (
                    Array.isArray(value) ? (
                      <span className="text-muted-foreground">Array[{value.length}]</span>
                    ) : Object.keys(value).length > 0 ? (
                      // Check if any nested values contain truncated data
                      Object.values(value).some((v: any) => v?.__truncated) ? (
                        <div className="pl-2 mt-1">
                          {renderData(value, fullKey)}
                        </div>
                      ) : (
                        <span className="font-mono text-muted-foreground bg-muted/20 px-2 py-1 rounded text-xs break-all">
                          {JSON.stringify(value).slice(0, 200)}
                          {JSON.stringify(value).length > 200 && '...'}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">{'{}'}</span>
                    )
                  ) : (
                    <span className="break-words">
                      {String(value).slice(0, 500)}
                      {String(value).length > 500 && '...'}
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
}) => {
  const [internalData, setInternalData] = useState<any>(data);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [browsingArray, setBrowsingArray] = useState<{ data: any[]; title: string } | null>(null);
  
  // Keep reference to original data for browsing
  const originalDataRef = useRef<any>(data);
  
  // Update original data ref when data changes
  useEffect(() => {
    originalDataRef.current = data;
  }, [data]);

  // Sync internal state when upstream data changes, unless pinned
  useEffect(() => {
    if (!pinned) {
      setInternalData(data);
      setIsEditing(false);
      setBrowsingArray(null);
    }
  }, [data, pinned]);

  // Truncate data for display - memoized to avoid re-processing
  const displayData = useMemo(() => {
    if (isStandardNodeOutput(internalData)) {
      // Truncate the data field within StandardNodeOutput
      const truncatedData = internalData.data !== undefined 
        ? truncateForDisplay(internalData.data).data 
        : undefined;
      
      return {
        success: internalData.success,
        status: internalData.status,
        ...(internalData.error !== undefined ? { error: internalData.error } : {}),
        ...(truncatedData !== undefined ? { data: truncatedData } : {}),
      };
    }
    return truncateForDisplay(internalData).data;
  }, [internalData]);
  
  // Get original data for browsing (handles StandardNodeOutput)
  const originalDataForBrowsing = useMemo(() => {
    if (isStandardNodeOutput(internalData)) {
      return internalData.data;
    }
    return internalData;
  }, [internalData]);
  
  // Handle browse callback
  const handleBrowse = (data: any[], title: string) => {
    setBrowsingArray({ data, title });
  };
  
  // Create renderData with browse callback
  const renderData = useMemo(() => {
    return createRenderData(originalDataForBrowsing, handleBrowse);
  }, [originalDataForBrowsing]);

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
      className={`absolute ${
        position === "right"
          ? "left-full top-0 ml-2"
          : "right-full top-0 mr-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden flex flex-col`}
    >
      {/* Virtualized array browser overlay */}
      {browsingArray ? (
        <VirtualizedArrayBrowser
          data={browsingArray.data}
          title={browsingArray.title}
          onClose={() => setBrowsingArray(null)}
        />
      ) : (
        <>
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
      <div className={`p-3 flex-1 overflow-auto ${showStreamingFooter ? 'pb-16' : ''}`}>
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
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-card border-t border-cyan-500/30 bg-gradient-to-t from-cyan-500/10 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-500">
              <Radio className="w-3 h-3 animate-pulse" />
              <span className="text-xs font-medium">Streaming...</span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={onStopListening}
              className="h-6 text-xs px-3"
            >
              <Square className="w-2 h-2 mr-1 fill-current" />
              Stop
            </Button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};

export default OutputPanel;
