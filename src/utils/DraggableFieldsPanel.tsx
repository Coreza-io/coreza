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

import React, { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VirtualizedArrayBrowser } from "@/components/workflow/VirtualizedArrayBrowser";
import { List } from "lucide-react";

type DraggableFieldsPanelProps = {
  data: unknown;
  onDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  parentKey?: string;
  maxItems?: number;
};

type Entry = { key: string; value: unknown };

const isObjectLike = (v: unknown): v is Record<string, unknown> | unknown[] =>
  v !== null && typeof v === "object";

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// Build property path segments for reference expressions
const buildPath = (parent: string, rawKey: string): string => {
  const isNumeric = /^\d+$/.test(rawKey);
  const needsQuote = /[^A-Za-z0-9_]/.test(rawKey);
  const seg = isNumeric ? `[${rawKey}]` : needsQuote ? `["${rawKey}"]` : rawKey;
  return parent ? `${parent}.${seg}` : seg;
};

const DraggableFieldsPanel: React.FC<DraggableFieldsPanelProps> = ({
  data,
  onDragStart,
  parentKey = "",
  maxItems = 25,
}) => {
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserData, setBrowserData] = useState<{ data: unknown[]; title: string } | null>(null);

  if (!isObjectLike(data)) return null;

  const isArray = Array.isArray(data);
  const totalLength = isArray ? data.length : 0;

  const entriesToShow: Entry[] = useMemo(() => {
    if (Array.isArray(data)) {
      return (data as unknown[]).slice(0, maxItems).map((item, idx) => ({
        key: String(idx),
        value: item,
      }));
    }
    return Object.entries(data as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }));
  }, [data, maxItems]);

  const remainingCount = isArray ? totalLength - entriesToShow.length : 0;

  const handleBrowseAll = (arrayData: unknown[], title: string) => {
    setBrowserData({ data: arrayData, title });
    setBrowserOpen(true);
  };

  return (
    <>
      <div className="flex flex-col gap-2 mb-2">
        {entriesToShow.map(({ key, value }) => {
          const fullKey = buildPath(parentKey, key);
          const isNestedObject = isObjectLike(value);
          const isNestedArray = Array.isArray(value);
          const nestedArrayLength = isNestedArray ? value.length : 0;
          const displayKey = isArray ? `[${key}]` : key;

          return (
            <div key={fullKey} className="flex flex-col ml-2">
              <div className="flex items-center gap-2">
                <div
                  className="nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs cursor-pointer font-semibold w-fit text-primary transition-colors cursor-grab active:cursor-grabbing"
                  draggable
                  onDragStart={(e) => {
                    const asString = toStringValue(value);
                    e.dataTransfer.setData(
                      "application/reactflow",
                      JSON.stringify({
                        type: "jsonReference",
                        keyPath: fullKey,
                        value: asString,
                      })
                    );
                    e.dataTransfer.effectAllowed = "copy";
                    onDragStart(e, fullKey, asString);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={
                    isNestedObject ? (isNestedArray ? "Array" : "Object") : toStringValue(value)
                  }
                >
                  {displayKey}
                </div>

                <span className="text-xs text-muted-foreground">
                  {isNestedObject ? (
                    <span className="font-mono text-muted-foreground/60">
                      {isNestedArray ? `[${nestedArrayLength}]` : "{...}"}
                    </span>
                  ) : (
                    toStringValue(value)
                  )}
                </span>

                {/* Browse All button for nested arrays with many items */}
                {isNestedArray && nestedArrayLength > maxItems && (
                  <button
                    className="nodrag text-xs text-primary hover:text-primary/80 flex items-center gap-1 ml-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBrowseAll(value, fullKey);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <List size={12} />
                    <span>Browse</span>
                  </button>
                )}
              </div>

              {isNestedObject && (
                <div className="ml-4">
                  <DraggableFieldsPanel
                    data={value}
                    onDragStart={onDragStart}
                    parentKey={fullKey}
                    maxItems={maxItems}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Show remaining items indicator for arrays */}
        {isArray && remainingCount > 0 && (
          <div className="ml-2 mt-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground italic">
              ... and {remainingCount.toLocaleString()} more item{remainingCount !== 1 ? 's' : ''}
            </span>
            <button
              className="nodrag text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                handleBrowseAll(data as unknown[], parentKey || 'Array');
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <List size={12} />
              <span>Browse All</span>
            </button>
          </div>
        )}
      </div>

      {/* Virtualized Array Browser Dialog */}
      <Dialog open={browserOpen} onOpenChange={setBrowserOpen}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 overflow-hidden">
          {browserData && (
            <VirtualizedArrayBrowser
              data={browserData.data}
              title={browserData.title}
              onClose={() => setBrowserOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default React.memo(DraggableFieldsPanel);
