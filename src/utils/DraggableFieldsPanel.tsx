/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { createJsonReferenceDragPayload, formatPath, type PathSegment } from "./referencePath";

type Props = {
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
const objectLike = (value: unknown): value is Record<string, unknown> | unknown[] => value !== null && typeof value === "object";
const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
};

/** One lazy tree owns a global render budget, including every expanded branch. */
const DraggableFieldsPanel: React.FC<Props> = ({ data, onDragStart, parentKey = "", pathSegments, sourceNodeId, maxItems = 25, draggable = true, persistentVariableKeys, variableNamespace = false }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pages, setPages] = useState<Record<string, number>>({});
  if (!objectLike(data)) return null;
  const budget = { entries: 200, characters: 20_000 };
  const text = (value: unknown) => {
    const limit = Math.max(0, Math.min(2000, budget.characters));
    const raw = typeof value === "string" ? value : stringify(value);
    const result = raw.length > limit ? `${raw.slice(0, limit)}…` : raw;
    budget.characters -= Math.min(raw.length, limit);
    return result;
  };
  const renderBranch = (source: Record<string, unknown> | unknown[], segments: PathSegment[], depth: number): React.ReactNode => {
    const branch = JSON.stringify(segments);
    const page = pages[branch] ?? 0;
    const pageSize = Math.max(1, Math.min(maxItems, 200));
    const keys: PathSegment[] = Array.isArray(source) ? [] : Object.keys(source);
    const length = Array.isArray(source) ? source.length : keys.length;
    const currentPage = Math.min(page, Math.max(0, Math.ceil(length / pageSize) - 1));
    const start = currentPage * pageSize;
    const entries: Entry[] = [];
    for (let index = start; index < Math.min(length, start + pageSize); index++) {
      const key = Array.isArray(source) ? index : keys[index];
      const value = (source as Record<PathSegment, unknown>)[key];
      if (depth === 0 && variableNamespace) entries.push({ key: `$vars.${key}`, value, variableKey: String(key) });
      else if (depth === 0 && key === "data" && persistentVariableKeys?.length && objectLike(value) && !Array.isArray(value)) {
        const remaining: Record<string, unknown> = Object.create(null);
        for (const [name, item] of Object.entries(value)) {
          if (persistentVariableKeys.includes(name) && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !["__proto__", "constructor", "prototype"].includes(name) && ["string", "number", "boolean"].includes(typeof item)) entries.push({ key: `$vars.${name}`, value: item, variableKey: name });
          else remaining[name] = item;
        }
        if (Object.keys(remaining).length) entries.push({ key, value: remaining });
      } else entries.push({ key, value });
    }
    return <div className="flex flex-col gap-2 mb-2">
      {entries.map(({ key, value, variableKey }) => {
        if (budget.entries <= 0 || budget.characters <= 0) return null;
        budget.entries -= 1;
        const fullSegments = [...segments, key];
        const path = JSON.stringify(fullSegments);
        const fullKey = (pathSegments ? formatPath(fullSegments) : `${parentKey}${formatPath(fullSegments)}`).replace(/^\./, "");
        const nested = objectLike(value);
        const reference = variableKey ? `{{ $vars.${variableKey} }}` : fullKey;
        const canDrag = draggable || Boolean(variableKey && sourceNodeId);
        const label = text(Array.isArray(source) ? `[${key}]` : String(key));
        return <div key={path} className="flex flex-col ml-2">
          <div className="flex items-center gap-2">
            {nested && <button type="button" className="nodrag text-xs" aria-label={`${expanded[path] ? "Collapse" : "Expand"} ${label}`} aria-expanded={!!expanded[path]} disabled={depth >= 12} onClick={() => setExpanded(previous => ({ ...previous, [path]: !previous[path] }))}>{expanded[path] ? "−" : "+"}</button>}
            <div className={`nodrag px-2 py-1 bg-primary/10 rounded text-xs font-semibold text-primary ${canDrag ? "cursor-grab" : "cursor-default"}`}
              draggable={canDrag} onMouseDown={event => event.stopPropagation()}
              onDragStart={event => {
                if (!canDrag) return;
                const raw = stringify(value);
                onDragStart(event, reference, raw);
                event.dataTransfer.setData("application/reactflow", JSON.stringify({ ...createJsonReferenceDragPayload(fullSegments, sourceNodeId, raw), ...(variableKey ? { variableKey } : {}) }));
                event.dataTransfer.setData("text/plain", reference);
                event.dataTransfer.effectAllowed = "copy";
              }} onDragEnd={() => document.body.classList.remove("cursor-grabbing", "select-none")}>{label}</div>
            <span className="text-xs text-muted-foreground break-all">{nested ? Array.isArray(value) ? `[${value.length} items]` : "{…}" : text(value)}</span>
          </div>
          {nested && expanded[path] && depth < 12 && budget.entries > 0 && budget.characters > 0 && <div className="ml-4">{renderBranch(value, fullSegments, depth + 1)}</div>}
        </div>;
      })}
      {length > pageSize && <div className="ml-2 flex items-center gap-2 text-xs">
        <button type="button" className="nodrag underline" disabled={start === 0} onClick={() => setPages(previous => ({ ...previous, [branch]: Math.max(0, currentPage - 1) }))}>Previous</button>
        <span>{start + 1}–{Math.min(length, start + pageSize)} of {length}</span>
        <button type="button" className="nodrag underline" disabled={start + pageSize >= length} onClick={() => setPages(previous => ({ ...previous, [branch]: currentPage + 1 }))}>Next</button>
      </div>}
    </div>;
  };
  const tree = renderBranch(data, pathSegments ?? [], 0);
  return <>{tree}{(budget.entries <= 0 || budget.characters <= 0) && <p role="status" className="text-xs text-muted-foreground">Display limit reached. Collapse a branch to inspect more, or export the complete output.</p>}</>;
};
export default React.memo(DraggableFieldsPanel);
