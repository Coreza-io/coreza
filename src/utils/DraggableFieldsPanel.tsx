// src/utils/DraggableFieldsPanel.tsx
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

  return (
    <div className="flex flex-col gap-2 mb-2">
      {Object.entries(data).map(([key, value]) => {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        const isObject = typeof value === "object" && value !== null;

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className="nodrag px-2 py-1 bg-blue-100 rounded text-xs cursor-pointer font-semibold w-fit"
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
              <span className="text-xs text-gray-700">
                {value === undefined ? (
                  <span className="text-gray-400">undefined</span>
                ) : isObject ? (
                  <span className="font-mono text-gray-400">{Array.isArray(value) ? "[...]" : "{...}"}</span>
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
