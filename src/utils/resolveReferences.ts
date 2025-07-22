
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
 * Generate display name for a node based on type and existing names
 */
function generateDisplayName(nodeType: string, existingDisplayNames: Set<string>): string {
  let baseName = nodeType;
  let counter = 1;
  let displayName = baseName;

  while (existingDisplayNames.has(displayName)) {
    counter++;
    displayName = `${baseName}${counter}`;
  }

  return displayName;
}

/**
 * Create a mapping from display names to technical node IDs
 */
function createDisplayNameMapping(nodes: any[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedDisplayNames = new Set<string>();

  // Sort nodes by creation time (extract timestamp from ID) to ensure consistent naming
  const sortedNodes = [...nodes].sort((a, b) => {
    const timestampA = parseInt(a.id.split('-').pop() || '0');
    const timestampB = parseInt(b.id.split('-').pop() || '0');
    return timestampA - timestampB;
  });

  for (const node of sortedNodes) {
    let displayName = node.displayName;
    
    // If no saved display name, generate one
    if (!displayName) {
      displayName = generateDisplayName(node.type, usedDisplayNames);
    }
    
    // Ensure uniqueness (handle duplicates in saved data)
    if (usedDisplayNames.has(displayName)) {
      displayName = generateDisplayName(node.type, usedDisplayNames);
    }
    
    mapping[displayName] = node.id;
    usedDisplayNames.add(displayName);
  }

  return mapping;
}

/**
 * Replaces {{ $json.x.y }} or {{ $('Node').json.x.y }} templates using inputData.
 * Now with support for negative array indexes, multi-node data lookup, and display name mapping.
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

  // Create display name to ID mapping if nodes are provided
  const displayNameMapping = nodes ? createDisplayNameMapping(nodes) : {};

  // Match $('NodeName').json.path or $json.path patterns
  const templateRegex = /\{\{\s*(?:\$\('([^']+)'\)\.json|\$json)(?:\.|\s*)([^\}]*?)\s*\}\}/g;

  return expr.replace(templateRegex, (fullMatch, nodeName, rawPath) => {
    console.log("🔍 Resolving reference:", { fullMatch, nodeName, rawPath, inputData, allNodeData, displayNameMapping });
    
    let targetData = inputData;
    
    // If nodeName is specified and we have allNodeData, look up the specific node's data
    if (nodeName && allNodeData) {
      // First try to resolve display name to technical ID
      let actualNodeId = nodeName;
      if (displayNameMapping[nodeName]) {
        actualNodeId = displayNameMapping[nodeName];
        console.log(`🔍 Mapped display name '${nodeName}' to ID '${actualNodeId}'`);
      }
      
      // Try both the original name and mapped ID
      let nodeData = allNodeData[actualNodeId] || allNodeData[nodeName];
      
      if (nodeData) {
        targetData = nodeData;
        console.log(`🔍 Found data for node '${nodeName}' (ID: ${actualNodeId}):`, targetData);
        
        // Handle nested json structure for Market Status and other nodes
        if (targetData.json) {
          targetData = targetData.json;
          console.log(`🔍 Using nested json data:`, targetData);
        }
      } else {
        console.warn(`🔍 No data found for node '${nodeName}' (tried ID: ${actualNodeId}), available nodes:`, Object.keys(allNodeData));
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

// Export the helper functions for use in other modules
export { createDisplayNameMapping, generateDisplayName };
