import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Pin, PinOff, Save, X } from "lucide-react";

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

// Recursively render output data, modern UI with design system
const renderData = (data: any, parentKey = ""): React.ReactNode => {
  console.log("Payload:", data)
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
                  <span className="font-mono text-muted-foreground bg-muted/20 px-2 py-1 rounded text-xs">
                    {JSON.stringify(value, null, 2)}
                  </span>
                ) : (
                  <span className="break-words">{String(value)}</span>
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
            {renderData(internalData)}
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;