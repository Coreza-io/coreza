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
 * Create display name mapping from node array
 */
function createDisplayNameMapping(nodes: any[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  nodes.forEach(node => {
    const displayName = generateDisplayName(node);
    mapping[displayName] = node.id;
  });
  return mapping;
}

/**
 * Generate display name for a node
 */
function generateDisplayName(node: any): string {
  // Use custom label if provided
  if (node.data?.values?.label && node.data.values.label.trim()) {
    return node.data.values.label.trim();
  }
  
  // Use definition name if available
  if (node.data?.definition?.name) {
    return node.data.definition.name;
  }
  
  // Fallback to node type
  return node.type || 'Unknown';
}

/**
 * Replaces {{ $json.x.y }} or {{ $('Node').json.x.y }} templates using inputData.
 * Now with support for negative array indexes, multi-node data lookup, and display name resolution.
 */
export function resolveReferences(
  expr: string, 
  inputData: any, 
  allNodeData?: Record<string, any>, 
  nodes?: any[]
): string {
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
      // First try direct lookup by node name
      if (allNodeData[nodeName]) {
        targetData = allNodeData[nodeName];
        console.log(`🔍 Found data for node '${nodeName}':`, targetData);
      } else if (nodes) {
        // Try lookup by display name if direct lookup fails
        const displayNameMapping = createDisplayNameMapping(nodes);
        const nodeId = displayNameMapping[nodeName];
        
        if (nodeId && allNodeData[nodeId]) {
          targetData = allNodeData[nodeId];
          console.log(`🔍 Found data for node '${nodeName}' via display name mapping (ID: ${nodeId}):`, targetData);
        } else {
          console.warn(`🔍 No data found for node '${nodeName}', available nodes:`, Object.keys(allNodeData));
          console.warn(`🔍 Available display names:`, Object.keys(displayNameMapping));
          return fullMatch; // Return original if node not found
        }
      } else {
        console.warn(`🔍 No data found for node '${nodeName}', available nodes:`, Object.keys(allNodeData));
        return fullMatch; // Return original if node not found
      }
      
      // Handle nested json structure for Market Status and other nodes
      if (targetData && targetData.json) {
        targetData = targetData.json;
        console.log(`🔍 Using nested json data:`, targetData);
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