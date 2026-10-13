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
import { useToast } from "@/hooks/use-toast";
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
};

type Entry = { key: PathSegment; value: unknown };

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
}) => {
  const { toast } = useToast();
  const copyReference = async (reference: string) => {
    try {
      await navigator.clipboard.writeText(reference);
      toast({ description: "Reference copied" });
    } catch {
      toast({ description: "Unable to copy reference", variant: "destructive" });
    }
  };
  const entriesToShow: Entry[] = useMemo(() => {
    if (!isObjectLike(data)) return [];
    if (Array.isArray(data)) {
      return (data as unknown[]).slice(0, maxItems).map((item, idx) => ({
        key: idx,
        value: item,
      }));
    }
    return Object.entries(data as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: v,
    }));
  }, [data, maxItems]);

  if (!isObjectLike(data)) return null;

  const isArray = Array.isArray(data);
  const totalLength = isArray ? data.length : 0;

  const remainingCount = isArray ? totalLength - entriesToShow.length : 0;

  return (
    <div className="flex flex-col gap-2 mb-2">
      {entriesToShow.map(({ key, value }) => {
        const fullSegments = [...(pathSegments ?? []), key];
        const fullKey = pathSegments
          ? formatPath(fullSegments).replace(/^\./, "")
          : parentKey
            ? `${parentKey}${formatPath([key])}`
            : formatPath([key]).replace(/^\./, "");
        const isNestedObject = isObjectLike(value);
        const displayKey = isArray ? `[${key}]` : String(key);
        const isPersistent = fullSegments.length === 2 && fullSegments[0] === "data"
          && typeof key === "string" && persistentVariableKeys?.includes(key)
          && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)
          && !["__proto__", "constructor", "prototype"].includes(key)
          && ["string", "number", "boolean"].includes(typeof value);

        return (
          <div key={fullKey} className="flex flex-col ml-2">
            <div className="flex items-center gap-2">
              <div
                className={`nodrag px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded text-xs font-semibold w-fit text-primary transition-colors ${
                  draggable
                    ? "cursor-pointer cursor-grab active:cursor-grabbing"
                    : "cursor-default"
                }`}
                draggable={draggable}
                onDragStart={(e) => {
                  if (!draggable) return;
                  const asString = toStringValue(value);
                  onDragStart(e, fullKey, asString);
                  e.dataTransfer.setData(
                    "application/reactflow",
                    JSON.stringify(
                      createJsonReferenceDragPayload(
                        fullSegments,
                        sourceNodeId,
                        asString,
                      ),
                    ),
                  );
                  e.dataTransfer.setData("text/plain", fullKey);
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
              {isPersistent && (
                <span className="text-[10px] text-primary" title="Written to workflow variables by this execution">Persistent</span>
              )}
            </div>

            {isPersistent && sourceNodeId && (
              <div className="flex flex-wrap gap-2 mt-1">
                {([
                  ["Variable reference", `{{ $vars${formatPath([key])} }}`, true],
                  ["Node output reference", `{{ $(${JSON.stringify(sourceNodeId)}).json${formatPath(fullSegments)} }}`, false],
                ] as const).map(([label, reference, variable]) => (
                  <button
                    key={label}
                    type="button"
                    className="nodrag text-[10px] text-primary underline underline-offset-2 cursor-grab"
                    title={`${variable ? "Preferred: reads the current workflow variable." : "Reads this node execution's output."} Click to copy; drag to insert ${reference}`}
                    aria-label={`Copy or drag ${label.toLowerCase()} for ${String(key)}`}
                    draggable
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); void copyReference(reference); }}
                    onDragStart={e => {
                      e.stopPropagation();
                      e.dataTransfer.setData("application/reactflow", JSON.stringify({
                        ...createJsonReferenceDragPayload(fullSegments, sourceNodeId, toStringValue(value)),
                        ...(variable ? { variableKey: key } : {}),
                      }));
                      e.dataTransfer.setData("text/plain", reference);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

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
