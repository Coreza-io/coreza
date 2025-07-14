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
 * Now with support for negative array indexes.
 */
export function resolveReferences(expr: string, inputData: any): string {
  if (!inputData || typeof expr !== 'string') {
    return expr;
  }

  // Match either $json or $('Node').json, then capture whatever path follows (dot or bracket).
  const templateRegex = /\{\{\s*(?:\$\('[^']+'\)\.json|\$json)(?:\.|\s*)([^\}]+?)\s*\}\}/g;

  return expr.replace(templateRegex, (_, rawPath) => {
    const cleanPath = rawPath.trim().replace(/^[.\s]+/, '');
    const keys = parsePath(cleanPath);

    let result: any = inputData;
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

    if (result === undefined) {
      // leave original placeholder if not found
      return `{{ $json.${cleanPath} }}`;
    }

    return (typeof result === 'object' && result !== null)
      ? JSON.stringify(result)
      : String(result);
  });
}