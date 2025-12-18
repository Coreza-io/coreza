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

import React, { useMemo } from "react";

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
  if (!isObjectLike(data)) return null;

  const isArray = Array.isArray(data);

  const entriesToShow: Entry[] = useMemo(() => {
    if (Array.isArray(data)) {
      return (data as unknown[]).slice(0, maxItems).map((item, idx) => ({
        key: String(idx),
        value: item,
      }));
    }
    return Object.entries(data as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }));
  }, [data, maxItems]);

  return (
    <div className="flex flex-col gap-2 mb-2">
      {entriesToShow.map(({ key, value }) => {
        const fullKey = buildPath(parentKey, key);
        const isNestedObject = isObjectLike(value);
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
                  isNestedObject ? (Array.isArray(value) ? "Array" : "Object") : toStringValue(value)
                }
              >
                {displayKey}
              </div>

              <span className="text-xs text-muted-foreground">
                {isNestedObject ? (
                  <span className="font-mono text-muted-foreground/60">
                    {Array.isArray(value) ? "[...]" : "{...}"}
                  </span>
                ) : (
                  toStringValue(value)
                )}
              </span>
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
    </div>
  );
};

export default React.memo(DraggableFieldsPanel);
