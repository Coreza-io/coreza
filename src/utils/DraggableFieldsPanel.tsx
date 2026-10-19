/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useMemo } from "react";
import {
  createJsonReferenceDragPayload,
  formatPath,
  type PathSegment,
} from "./referencePath";

type DraggableFieldsPanelProps = {
  data: unknown;
  onDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  parentKey?: string;
  pathSegments?: PathSegment[];
  sourceNodeId?: string;
  maxItems?: number;
  draggable?: boolean;
  persistentVariableKeys?: readonly string[];
  variableNamespace?: boolean;
};

type Entry = { key: PathSegment; value: unknown; variableKey?: string };

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

const DraggableFieldsPanel: React.FC<DraggableFieldsPanelProps> = ({
  data,
  onDragStart,
  parentKey = "",
  pathSegments,
  sourceNodeId,
  maxItems = 25,
  draggable = true,
  persistentVariableKeys,
  variableNamespace = false,
}) => {
  const entriesToShow: Entry[] = useMemo(() => {
    if (!isObjectLike(data)) return [];
    if (Array.isArray(data)) {
      return (data as unknown[]).slice(0, maxItems).map((item, idx) => ({
        key: idx,
        value: item,
      }));
    }
    return Object.entries(data as Record<string, unknown>).flatMap(([key, value]): Entry[] => {
      if (variableNamespace) return [{ key: `$vars.${key}`, value, variableKey: key }];
      if (key !== "data" || pathSegments?.length || !persistentVariableKeys?.length
        || !isObjectLike(value) || Array.isArray(value)) return [{ key, value }];
      // Display accepted Persistent fields directly in the workflow variable namespace.
      // The execution output itself retains its original data shape.
      const variables: Entry[] = [];
      const remaining: Record<string, unknown> = Object.create(null);
      for (const [name, fieldValue] of Object.entries(value)) {
        if (persistentVariableKeys.includes(name) && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)
          && !["__proto__", "constructor", "prototype"].includes(name)
          && ["string", "number", "boolean"].includes(typeof fieldValue)) {
          variables.push({ key: `$vars.${name}`, value: fieldValue, variableKey: name });
        } else remaining[name] = fieldValue;
      }
      return [...(Object.keys(remaining).length ? [{ key, value: remaining }] : []), ...variables];
    });
  }, [data, maxItems, pathSegments, persistentVariableKeys, variableNamespace]);

  if (!isObjectLike(data)) return null;

  const isArray = Array.isArray(data);
  const totalLength = isArray ? data.length : 0;

  const remainingCount = isArray ? totalLength - entriesToShow.length : 0;

  return (
    <div className="flex flex-col gap-2 mb-2">
      {entriesToShow.map(({ key, value, variableKey }) => {
        const fullSegments = [...(pathSegments ?? []), key];
        const fullKey = pathSegments
          ? formatPath(fullSegments).replace(/^\./, "")
          : parentKey
            ? `${parentKey}${formatPath([key])}`
            : formatPath([key]).replace(/^\./, "");
        const isNestedObject = isObjectLike(value);
        const displayKey = isArray ? `[${key}]` : String(key);
        const canDrag = draggable || Boolean(variableKey && sourceNodeId);
        const reference = variableKey ? `{{ $vars.${variableKey} }}` : fullKey;

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className={`nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs font-semibold w-fit text-primary transition-colors ${
                  canDrag
                    ? "cursor-pointer cursor-grab active:cursor-grabbing"
                    : "cursor-default"
                }`}
                draggable={canDrag}
                onDragStart={(e) => {
                  if (!canDrag) return;
                  const asString = toStringValue(value);
                  onDragStart(e, reference, asString);
                  e.dataTransfer.setData(
                    "application/reactflow",
                    JSON.stringify(
                      {
                        ...createJsonReferenceDragPayload(fullSegments, sourceNodeId, asString),
                        ...(variableKey ? { variableKey } : {}),
                      },
                    ),
                  );
                  e.dataTransfer.setData("text/plain", reference);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() =>
                  document.body.classList.remove(
                    "cursor-grabbing",
                    "select-none",
                  )
                }
                onMouseDown={(e) => e.stopPropagation()}
                title={
                  isNestedObject
                    ? Array.isArray(value)
                      ? "Array"
                      : "Object"
                    : toStringValue(value)
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
                  pathSegments={fullSegments}
                  sourceNodeId={sourceNodeId}
                  maxItems={maxItems}
                  draggable={draggable}
                  persistentVariableKeys={persistentVariableKeys}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Show remaining items indicator for arrays */}
      {isArray && remainingCount > 0 && (
        <div className="ml-2 mt-1 text-xs text-muted-foreground italic">
          ... and {remainingCount.toLocaleString()} more item
          {remainingCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
};

export default React.memo(DraggableFieldsPanel);
