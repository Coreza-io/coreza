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

  // Prepare entries for objects and arrays (preserve arrays with indexed view)
  const isArray = Array.isArray(data);
  let entriesToShow: [string, any][];
  if (isArray) {
    const MAX_ITEMS = 25;
    const arr = data as any[];
    entriesToShow = arr.slice(0, MAX_ITEMS).map((item, idx) => [String(idx), item]);
  } else {
    entriesToShow = Object.entries(data);
  }

  

  return (
    <div className="flex flex-col gap-2 mb-2">
      {Array.isArray(data) && parentKey ? (
        <div className="flex items-center gap-2 ml-2">
          <div
            className="nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs cursor-pointer font-semibold w-fit text-primary transition-colors"
            draggable
            onDragStart={e => {
              const value = JSON.stringify(data);
              e.dataTransfer.setData("application/reactflow", JSON.stringify({ 
                type: "jsonReference", 
                keyPath: parentKey, 
                value 
              }));
              e.dataTransfer.effectAllowed = "copy";
              onDragStart(e, parentKey, value);
            }}
            onMouseDown={e => e.stopPropagation()}
            title={`Array(${(data as any[]).length})`}
          >
            Entire Array [{(data as any[]).length}]
          </div>
        </div>
      ) : null}
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