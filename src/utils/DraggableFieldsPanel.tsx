import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface DraggableFieldsPanelProps {
  data: any;
  onDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
}

const DraggableFieldsPanel: React.FC<DraggableFieldsPanelProps> = ({ 
  data, 
  onDragStart 
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const toggleExpanded = (keyPath: string) => {
    const newExpanded = new Set(expandedKeys);
    if (newExpanded.has(keyPath)) {
      newExpanded.delete(keyPath);
    } else {
      newExpanded.add(keyPath);
    }
    setExpandedKeys(newExpanded);
  };

  const renderValue = (
    obj: any,
    keyPath: string = "",
    depth: number = 0
  ): React.ReactNode => {
    // Prevent infinite depth
    if (depth > 5) {
      return <span className="text-muted-foreground text-xs">...</span>;
    }

    if (obj === null || obj === undefined) {
      return (
        <span
          className="text-muted-foreground cursor-grab hover:text-primary transition-colors text-xs px-1 py-0.5 rounded"
          draggable
          onDragStart={(e) => onDragStart(e, keyPath, String(obj))}
        >
          {obj === null ? "null" : "undefined"}
        </span>
      );
    }

    if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
      const displayValue = typeof obj === "string" && obj.length > 100 
        ? obj.slice(0, 97) + "..." 
        : String(obj);
      
      return (
        <span
          className="text-primary cursor-grab hover:text-primary-glow transition-colors text-xs px-1 py-0.5 rounded bg-primary/5 hover:bg-primary/10"
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            onDragStart(e, keyPath, String(obj));
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title={String(obj)}
        >
          {displayValue}
        </span>
      );
    }

    if (Array.isArray(obj)) {
      const isExpanded = expandedKeys.has(keyPath);
      return (
        <div className="text-xs">
          <div
            className="flex items-center gap-1 cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded"
            onClick={() => toggleExpanded(keyPath)}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">
              Array ({obj.length} items)
            </span>
          </div>
          {isExpanded && (
            <div className="ml-4 space-y-1 border-l border-border/30 pl-2">
              {obj.slice(0, 20).map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0 text-xs">
                    [{index}]:
                  </span>
                  <div className="min-w-0">
                    {renderValue(item, `${keyPath}[${index}]`, depth + 1)}
                  </div>
                </div>
              ))}
              {obj.length > 20 && (
                <div className="text-muted-foreground text-xs italic">
                  ... and {obj.length - 20} more items
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (typeof obj === "object") {
      const entries = Object.entries(obj);
      const isExpanded = expandedKeys.has(keyPath);
      
      // For root level objects (depth 0), show direct properties instead of expandable object
      if (depth === 0) {
        return (
          <div className="space-y-1">
            {entries.slice(0, 15).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2">
                  <span
                    className="text-primary cursor-grab hover:text-primary-glow transition-colors text-xs px-1 py-0.5 rounded bg-primary/5 hover:bg-primary/10 font-medium"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      onDragStart(e, key, String(key));
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`Drag ${key} field`}
                  >
                    {key}
                  </span>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {Array.isArray(value) 
                    ? `Array (${value.length} items)`
                    : typeof value === 'object' && value !== null
                    ? `Object (${Object.keys(value).length} properties)`
                    : typeof value === 'string' && value.length > 20
                    ? `${value.slice(0, 20)}...`
                    : String(value)
                  }
                </div>
              </div>
            ))}
            {entries.length > 15 && (
              <div className="text-muted-foreground text-xs italic">
                ... and {entries.length - 15} more properties
              </div>
            )}
          </div>
        );
      }
      
      return (
        <div className="text-xs">
          <div
            className="flex items-center gap-1 cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded"
            onClick={() => toggleExpanded(keyPath)}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">
              Object ({entries.length} properties)
            </span>
          </div>
          {isExpanded && (
            <div className="ml-4 space-y-1 border-l border-border/30 pl-2">
              {entries.slice(0, 15).map(([key, value]) => (
                <div key={key} className="flex items-start gap-2">
                  <span
                    className="text-primary cursor-grab hover:text-primary-glow transition-colors text-xs px-1 py-0.5 rounded bg-primary/5 hover:bg-primary/10 font-medium"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      onDragStart(e, keyPath ? `${keyPath}.${key}` : key, String(key));
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`Drag ${key} field`}
                  >
                    {key}
                  </span>
                  <div className="min-w-0">
                    {renderValue(
                      value,
                      keyPath ? `${keyPath}.${key}` : key,
                      depth + 1
                    )}
                  </div>
                </div>
              ))}
              {entries.length > 15 && (
                <div className="text-muted-foreground text-xs italic">
                  ... and {entries.length - 15} more properties
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <span
        className="text-warning cursor-grab hover:text-warning/80 transition-colors text-xs px-1 py-0.5 rounded"
        draggable
        onDragStart={(e) => onDragStart(e, keyPath, String(obj))}
      >
        {String(obj)}
      </span>
    );
  };

  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    return (
      <div className="text-center py-8">
        <div className="text-muted-foreground text-xs">No data to display</div>
      </div>
    );
  }

  // If root data is an array with a single object, unwrap it for cleaner display
  let displayData = data;
  if (Array.isArray(data) && data.length === 1 && typeof data[0] === 'object' && data[0] !== null) {
    displayData = data[0];
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Drag fields to input boxes:
      </div>
      <div className="max-h-64 overflow-auto">
        {renderValue(displayData, "", 0)}
      </div>
    </div>
  );
};

export default DraggableFieldsPanel;