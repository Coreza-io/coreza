import React from "react";

const DraggableFieldsPanel = ({
  data,
  onDragStart,
  parentKey = "",
}: {
  data: any;
  onDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  parentKey?: string;
}) => {
  if (!data || typeof data !== "object") return null;

  // Filter out numeric array indices only when we're dealing with arrays
  // but keep meaningful object properties
  const filteredEntries = Object.entries(data).filter(([key, value]) => {
    // Only skip numeric keys if the parent is an array AND it's a pure numeric index
    if (Array.isArray(data) && /^\d+$/.test(key)) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex flex-col gap-2 mb-2">
      {filteredEntries.map(([key, value]) => {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const isObject = typeof value === "object" && value !== null;

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className="nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs cursor-pointer font-semibold w-fit text-primary transition-colors"
                draggable
                onDragStart={e =>
                  onDragStart(
                    e,
                    fullKey,
                    isObject ? JSON.stringify(value) : String(value ?? "")
                  )
                }
                onMouseDown={e => e.stopPropagation()}
                title={isObject ? JSON.stringify(value) : String(value ?? "")}
              >
                {key}
              </div>
              <span className="text-xs text-muted-foreground">
                {value === undefined ? (
                  <span className="text-muted-foreground/60">undefined</span>
                ) : isObject ? (
                  <span className="font-mono text-muted-foreground/60">{Array.isArray(value) ? "[...]" : "{...}"}</span>
                ) : (
                  String(value)
                )}
              </span>
            </div>
            {/* Recursively render nested fields */}
            {isObject && (
              <DraggableFieldsPanel
                data={value}
                onDragStart={onDragStart}
                parentKey={fullKey}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DraggableFieldsPanel;