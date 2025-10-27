export function summarizePreview(value: any, maxArrayItems = 3, maxLength = 100): string {
  try {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return 'null';
    }

    // Handle strings - try to parse as JSON first
    if (typeof value === "string") {
      let parsed;
      try {
        parsed = JSON.parse(value);
        // If successfully parsed, use the parsed value for summarization
        value = parsed;
      } catch {
        // If not JSON, treat as regular string
        return value.length > maxLength ? value.slice(0, maxLength) + "..." : value;
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      const arr = value.slice(0, maxArrayItems);
      const preview = arr.map(item => 
        typeof item === 'object' ? JSON.stringify(item).slice(0, 30) + (JSON.stringify(item).length > 30 ? '...' : '') : String(item)
      );
      return `[${preview.join(", ")}${value.length > maxArrayItems ? `, ... (${value.length} items)` : ""}]`;
    }

    // Handle objects
    if (typeof value === "object" && value !== null) {
      const keys = Object.keys(value);
      if (keys.length === 0) return "{}";
      
      const preview = keys.slice(0, 3).map((k) => {
        if (Array.isArray(value[k])) {
          const arrPreview = value[k].slice(0, maxArrayItems);
          return `${k}: [${arrPreview.map(String).join(", ")}${value[k].length > maxArrayItems ? ", ..." : ""}]`;
        } else if (typeof value[k] === 'object' && value[k] !== null) {
          return `${k}: {...}`;
        } else {
          const stringified = JSON.stringify(value[k]);
          return `${k}: ${stringified.length > 30 ? stringified.slice(0, 30) + "..." : stringified}`;
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
    return jsonStr.length > maxLength ? jsonStr.slice(0, maxLength) + "..." : jsonStr;

  } catch (error) {
    // Safe fallback
    const fallback = String(value);
    return fallback.length > maxLength ? fallback.slice(0, maxLength) + "..." : fallback;
  }
}