import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X } from "lucide-react";
import { format } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

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
};

// Helper to detect ISO date strings
const isISODateString = (value: any): boolean => {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(value);
};

// Helper to format dates in user's timezone
const formatDateWithTimezone = (isoString: string, timezone?: string): string => {
  try {
    if (!timezone || timezone === 'UTC') {
      return `${new Date(isoString).toUTCString()} (UTC)`;
    }
    
    const zonedDate = toZonedTime(isoString, timezone);
    const formatted = formatInTimeZone(isoString, timezone, 'EEE MMM dd yyyy HH:mm:ss');
    const offset = format(zonedDate, 'xxx');
    
    return `${formatted} GMT${offset.replace(':', '')} (${timezone})`;
  } catch (error) {
    console.error('Date formatting error:', error);
    return isoString;
  }
};

// Recursively render output data, modern UI with design system
const renderData = (data: any, parentKey = "", rootData?: any): React.ReactNode => {
  console.log("Payload:", data);
  
  // Extract timezone from response (if available)
  const timezone = rootData?.schedule?.timezone || rootData?.timezone;
  
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
          
          // Check if this value is a date string and format it
          const isDate = isISODateString(value);
          const displayValue = isDate ? formatDateWithTimezone(value as string, timezone) : value;
          
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
                  <span className={`break-words ${isDate ? 'font-medium text-green-600 dark:text-green-400' : ''}`}>
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
        <div className="font-semibold text-foreground text-sm tracking-tight">
          Output Data
        </div>
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
            {renderData(internalData, "", internalData)}
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;