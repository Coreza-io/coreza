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
          ? JSON.stringify(item).slice(0, 30) +
            (JSON.stringify(item).length > 30 ? "..." : "")
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

// Truncate large data structures for preview to avoid performance issues
function truncateForPreview(obj: any, maxItems: number, depth: number): any {
  if (depth <= 0) return "[Object]";

  if (Array.isArray(obj)) {
    if (obj.length > maxItems) {
      const truncated = obj
        .slice(0, maxItems)
        .map((item) =>
          typeof item === "object" && item !== null
            ? truncateForPreview(item, maxItems, depth - 1)
            : item,
        );
      return truncated;
    }
    return obj.map((item) =>
      typeof item === "object" && item !== null
        ? truncateForPreview(item, maxItems, depth - 1)
        : item,
    );
  }

  if (typeof obj === "object" && obj !== null) {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] =
        typeof value === "object" && value !== null
          ? truncateForPreview(value, maxItems, depth - 1)
          : value;
    }
    return result;
  }

  return obj;
}

// Format preview with smart truncation for large arrays
export function fullePreview(value: any, maxItems = 5, maxDepth = 3): string {
  try {
    if (value === null) return "null";
    if (value === undefined) return "undefined";

    if (typeof value === "string") {
      return value;
    }

    // For large arrays, truncate and show summary
    if (Array.isArray(value) && value.length > maxItems) {
      const totalItems = value.length;
      const truncated = truncateForPreview(
        value.slice(0, maxItems),
        maxItems,
        maxDepth,
      );
      const previewJson = JSON.stringify(truncated, null, 2);
      // Remove closing bracket and add indicator
      return `${previewJson.slice(0, -1)},\n  // ... and ${(totalItems - maxItems).toLocaleString()} more items\n]`;
    }

    // For objects, truncate any large nested arrays
    if (typeof value === "object" && value !== null) {
      const truncated = truncateForPreview(value, maxItems, maxDepth);
      return JSON.stringify(truncated, null, 2);
    }

    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error("❌ Preview formatting error:", error);
    return String(value);
  }
}
