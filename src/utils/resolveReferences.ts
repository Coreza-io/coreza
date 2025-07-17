/**
 * Turn a path like "0.candles[1].value" or "['foo'].bar" into an array of keys/indexes.
 * Now supports negative numbers (e.g. -1, -2).
 */
function parsePath(path: string): Array<string|number> {
  const parts: Array<string|number> = [];
  const regex = /([^[.\]]+)|\[(\-?\d+|["'][^"']+["'])\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path))) {
    const [ , dotKey, bracketKey ] = match;
    if (dotKey !== undefined) {
      parts.push(dotKey);
    } else {
      // bracketKey is either a quoted string or a number (possibly negative)
      if (/^-?\d+$/.test(bracketKey!)) {
        parts.push(Number(bracketKey));      // e.g. "-1" → -1
      } else {
        parts.push(bracketKey!.slice(1, -1)); // strip quotes from 'foo' or "foo"
      }
    }
  }

  return parts;
}

/**
 * Replaces {{ $json.x.y }} or {{ $('Node').json.x.y }} templates using inputData.
 * Now with support for negative array indexes and multi-node data lookup.
 */
export function resolveReferences(expr: string, inputData: any, allNodeData?: Record<string, any>): string {
  if (!inputData || typeof expr !== 'string') {
    return expr;
  }

  // Match $('NodeName').json.path or $json.path patterns
  const templateRegex = /\{\{\s*(?:\$\('([^']+)'\)\.json|\$json)(?:\.|\s*)([^\}]*?)\s*\}\}/g;

  return expr.replace(templateRegex, (fullMatch, nodeName, rawPath) => {
    console.log("🔍 Resolving reference:", { fullMatch, nodeName, rawPath, inputData, allNodeData });
    
    let targetData = inputData;
    
    // If nodeName is specified and we have allNodeData, look up the specific node's data
    if (nodeName && allNodeData) {
      if (allNodeData[nodeName]) {
        targetData = allNodeData[nodeName];
        console.log(`🔍 Found data for node '${nodeName}':`, targetData);
      } else {
        console.warn(`🔍 No data found for node '${nodeName}', available nodes:`, Object.keys(allNodeData));
        return fullMatch; // Return original if node not found
      }
    }
    
    const cleanPath = rawPath?.trim().replace(/^[.\s]+/, '') || '';
    
    // If no path specified (e.g., just {{ $('Alpaca').json }}), return the whole object
    if (!cleanPath) {
      return (typeof targetData === 'object' && targetData !== null)
        ? JSON.stringify(targetData)
        : String(targetData);
    }
    
    const keys = parsePath(cleanPath);
    console.log("🔍 Parsed keys:", keys);

    let result: any = targetData;
    for (const key of keys) {
      //console.log("🔍 Accessing key:", key, "in:", result);
      if (result == null) { 
        result = undefined; 
        break; 
      }

      // If we're indexing into an array with a number...
      if (Array.isArray(result) && typeof key === 'number') {
        // handle negative indexes
        const idx = key >= 0 ? key : result.length + key;
        result = result[idx];
      } else {
        result = result[key as keyof typeof result];
      }
    }

    console.log("🔍 Final result:", result);

    if (result === undefined) {
      // leave original placeholder if not found
      return fullMatch;
    }

    return (typeof result === 'object' && result !== null)
      ? JSON.stringify(result)
      : String(result);
  });
}