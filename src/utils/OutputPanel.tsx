import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, Pin, PinOff, Edit, Save } from "lucide-react";

interface OutputPanelProps {
  isExpanded?: boolean;
  data?: any;
  position?: "left" | "right";
  pinned?: boolean;
  onSave?: (data: any) => void;
  onPinToggle?: () => void;
}

const OutputPanel: React.FC<OutputPanelProps> = ({
  isExpanded = true,
  data = {},
  position = "right",
  pinned = false,
  onSave,
  onPinToggle,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState("");

  if (!isExpanded) {
    return null;
  }

  const handleEdit = () => {
    setEditedData(JSON.stringify(data, null, 2));
    setIsEditing(true);
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editedData);
      onSave?.(parsed);
      setIsEditing(false);
    } catch (error) {
      // Handle JSON parse error
      console.error("Invalid JSON:", error);
    }
  };

  const renderDataTree = (obj: any, path = '', depth = 0): React.ReactNode => {
    if (depth > 3) {
      return <span className="text-muted-foreground">...</span>;
    }

    if (obj === null || obj === undefined) {
      return <span className="text-muted-foreground">null</span>;
    }

    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return <span className="text-foreground">{String(obj)}</span>;
    }

    if (Array.isArray(obj)) {
      return (
        <div className="space-y-1">
          {obj.slice(0, 5).map((item, idx) => (
            <div key={idx} className="ml-4">
              <span className="text-muted-foreground">[{idx}]:</span>{' '}
              {renderDataTree(item, `${path}[${idx}]`, depth + 1)}
            </div>
          ))}
          {obj.length > 5 && (
            <div className="ml-4 text-muted-foreground text-xs">
              ... and {obj.length - 5} more items
            </div>
          )}
        </div>
      );
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj).slice(0, 10);
      return (
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="ml-4">
              <span className="text-muted-foreground">{key}:</span>{' '}
              {renderDataTree(value, path ? `${path}.${key}` : key, depth + 1)}
            </div>
          ))}
          {Object.keys(obj).length > 10 && (
            <div className="ml-4 text-muted-foreground text-xs">
              ... and {Object.keys(obj).length - 10} more properties
            </div>
          )}
        </div>
      );
    }

    return <span className="text-muted-foreground">{String(obj)}</span>;
  };

  const positionClass = position === "left" ? "right-[-320px]" : "left-[-320px]";

  return (
    <Card className={`absolute ${positionClass} top-0 w-80 bg-card border border-border shadow-card z-10`}>
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Output Data</span>
          </div>
          
          <div className="flex items-center gap-1">
            {onPinToggle && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onPinToggle}
                className="h-6 w-6 p-0"
                title={pinned ? "Unpin data" : "Pin data"}
              >
                {pinned ? (
                  <PinOff className="h-3 w-3" />
                ) : (
                  <Pin className="h-3 w-3" />
                )}
              </Button>
            )}
            
            {onSave && !isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEdit}
                className="h-6 w-6 p-0"
                title="Edit data"
              >
                <Edit className="h-3 w-3" />
              </Button>
            )}
            
            {isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSave}
                className="h-6 w-6 p-0"
                title="Save changes"
              >
                <Save className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-64 overflow-auto text-xs">
          {isEditing ? (
            <textarea
              value={editedData}
              onChange={(e) => setEditedData(e.target.value)}
              className="w-full h-48 p-2 text-xs font-mono bg-background border border-border rounded resize-none"
              placeholder="Enter JSON data..."
            />
          ) : (
            <>
              {Object.keys(data).length > 0 || Array.isArray(data) ? (
                renderDataTree(data)
              ) : (
                <div className="text-muted-foreground text-center py-4">
                  No output data
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
};

export default OutputPanel;