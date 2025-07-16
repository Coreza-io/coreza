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

  console.log("DraggableFieldsPanel data:", data);
  console.log("DraggableFieldsPanel data type:", typeof data);
  console.log("DraggableFieldsPanel is array:", Array.isArray(data));

  // Handle arrays by flattening their meaningful properties
  let entriesToShow;
  if (Array.isArray(data)) {
    // For arrays, collect all unique keys from all objects in the array
    const allKeys = new Set();
    const flattenedData = {};
    
    data.forEach((item, index) => {
      if (item && typeof item === "object") {
        Object.keys(item).forEach(key => {
          allKeys.add(key);
          // Use the last occurrence of each key (or combine them somehow)
          flattenedData[key] = item[key];
        });
      }
    });
    
    entriesToShow = Object.entries(flattenedData);
    console.log("Array flattened to:", flattenedData);
  } else {
    // For objects, use them directly
    entriesToShow = Object.entries(data);
  }

  console.log("Final entries to show:", entriesToShow);

  return (
    <div className="flex flex-col gap-2 mb-2">
      {entriesToShow.map(([key, value]) => {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const isObject = typeof value === "object" && value !== null;

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className="nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs cursor-pointer font-semibold w-fit text-primary transition-colors"
                draggable
                onDragStart={e => {
                  console.log("🎯 DRAG START:", { fullKey, value });
                  e.dataTransfer.setData("application/reactflow", JSON.stringify({ 
                    type: "jsonReference", 
                    keyPath: fullKey, 
                    value: isObject ? JSON.stringify(value) : String(value ?? "") 
                  }));
                  e.dataTransfer.effectAllowed = "copy";
                  console.log("✅ Data set in drag:", e.dataTransfer.getData("application/reactflow"));
                  onDragStart(
                    e,
                    fullKey,
                    isObject ? JSON.stringify(value) : String(value ?? "")
                  );
                }}
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