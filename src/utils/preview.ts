/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { format } from "date-fns";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

// Helper to detect ISO date strings
const isISODateString = (value: any): boolean => {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(value);
};

// Helper to format dates in user's timezone
const formatDateWithTimezone = (
  isoString: string,
  timezone?: string,
): string => {
  try {
    const tz = timezone || "UTC";
    const formatted = formatInTimeZone(isoString, tz, "yyyy-MM-dd HH:mm:ss");
    return formatted;
  } catch (error) {
    console.error("Date formatting error:", error);
    return isoString;
  }
};

export function summarizePreview(
  value: any,
  maxArrayItems = 3,
  maxLength = 100,
  timezone?: string,
): string {
  try {
    // Handle null/undefined
    // if (value === null || value === undefined) {
    //   return "null";
    // }

    // Handle strings - check for dates first, then try JSON parse
    if (typeof value === "string") {
      // Check if it's a date string BEFORE trying to parse as JSON
      if (isISODateString(value)) {
        return formatDateWithTimezone(value, timezone);
      }

      if (value.length > 10_000) return value.slice(0, maxLength) + "…";
      let parsed;
      try {
        parsed = JSON.parse(value);
        // If successfully parsed, use the parsed value for summarization
        value = parsed;
      } catch {
        // If not JSON, treat as regular string
        return value.length > maxLength
          ? value.slice(0, maxLength) + "..."
          : value;
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      const arr = value.slice(0, maxArrayItems);
      const preview = arr.map((item) =>
        typeof item === "object"
          ? fullePreview(item, 2, 1).slice(0, 60)
          : String(item),
      );
      return `[${preview.join(", ")}${
        value.length > maxArrayItems ? `, ... (${value.length} items)` : ""
      }]`;
    }

    // Handle objects
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 0) return "{}";

      const preview = keys.slice(0, 3).map((k) => {
        if (Array.isArray(value[k])) {
          const arrPreview = value[k].slice(0, maxArrayItems);
          return `${k}: [${arrPreview.map(String).join(", ")}${
            value[k].length > maxArrayItems ? ", ..." : ""
          }]`;
        } else if (typeof value[k] === "object" && value[k] !== null) {
          return `${k}: {...}`;
        } else {
          const stringified = JSON.stringify(value[k]);
          return `${k}: ${
            stringified.length > 30
              ? stringified.slice(0, 30) + "..."
              : stringified
          }`;
        }
      });

      return `{ ${preview.join(", ")}${keys.length > 3 ? ", ..." : ""} }`;
    }

    // Handle primitives
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    // Fallback to JSON stringification
    const jsonStr = JSON.stringify(value);
    return jsonStr.length > maxLength
      ? jsonStr.slice(0, maxLength) + "..."
      : jsonStr;
  } catch (error) {
    // Safe fallback
    const fallback = String(value);
    return fallback.length > maxLength
      ? fallback.slice(0, maxLength) + "..."
      : fallback;
  }
}

// Bounds apply to the entire preview, rather than independently to every nested array.
export function fullePreview(value: unknown, maxItems = 5, maxDepth = 3): string {
  let entries = 200;
  let characters = 10_000;
  const visit = (item: unknown, depth: number): unknown => {
    if (--entries < 0 || characters <= 0) return "…";
    if (typeof item === "string") {
      const limit = Math.min(characters, 2000);
      characters -= Math.min(item.length, limit);
      return item.length > limit ? `${item.slice(0, limit)}…` : item;
    }
    if (item === null || typeof item !== "object") return item;
    if (depth <= 0) return Array.isArray(item) ? `[${item.length} items]` : "{…}";
    if (Array.isArray(item)) {
      const result = item.slice(0, Math.min(maxItems, entries)).map(value => visit(value, depth - 1));
      if (item.length > result.length) result.push(`… ${item.length - result.length} more items`);
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    let count = 0;
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      if (count++ >= maxItems || entries <= 0 || characters <= 0) { result["…"] = "More fields"; break; }
      const displayKey = key.slice(0, 200);
      characters -= displayKey.length;
      result[displayKey] = visit((item as Record<string, unknown>)[key], depth - 1);
    }
    return result;
  };
  if (value === undefined) return "undefined";
  const bounded = visit(value, maxDepth);
  return typeof bounded === "string" ? bounded : JSON.stringify(bounded, null, 2) ?? String(bounded);
}

/** Conservative edit eligibility check; never stringify an oversized payload first. */
export function canEditJson(value: unknown, maxCharacters = 100_000): boolean {
  let remaining = maxCharacters;
  let entries = 10_000;
  const active = new Set<object>();
  const visit = (item: unknown, depth: number): boolean => {
    if (--entries < 0 || depth > 64 || remaining <= 0) return false;
    if (typeof item === "string") { remaining -= item.length * 6 + 2; return remaining > 0; }
    remaining -= 32;
    if (!item || typeof item !== "object") return remaining > 0;
    if (active.has(item)) return false;
    active.add(item);
    for (const key in item) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) continue;
      remaining -= key.length * 6 + depth * 2 + 8;
      if (!visit((item as Record<string, unknown>)[key], depth + 1)) return false;
    }
    active.delete(item);
    return remaining > 0;
  };
  return visit(value, 0);
}
