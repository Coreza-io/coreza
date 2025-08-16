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
 * Now with support for negative array indexes, multi-node data lookup, and display name resolution.
 */
export function resolveReferences(
  expr: string,
  inputData: any,
  allNodeData?: Record<string, any>,
  nodes?: any[]
): string {
  if (typeof expr !== 'string') {
    return expr as any;
  }

  const templateRegex = /\{\{\s*(?:(?:\$\(\s*'([^']+)'\s*\)\s*\.json)|(?:\$node\[\s*(?:"([^"]+)"|'([^']+)')\s*\]\s*\.json)|(?:\$json))(?:(?:\s*\.\s*)|\s*)([^}]*)\s*\}\}/g;

  function pickJsonSource(d: any) {
    if (d == null) return d;
    const candidates = [
      d.json,
      d.output?.json,
      d.output,
      d.input?.json,
      d.input,
      d.data?.output?.json,
      d.data?.output,
      d.data?.input?.json,
      d.data?.input,
      d,
    ];
    for (const c of candidates) if (c !== undefined) return c;
    return d;
  }

  function resolveNodeKey(
    nodeName: string,
    allNodeData?: Record<string, any>,
    nodes?: Array<{ id: string; data?: any; label?: string; name?: string }>
  ): string | undefined {
    if (!nodeName) return undefined;
    if (allNodeData?.[nodeName] !== undefined) return nodeName;
    const candidate = nodes?.find(
      (n) =>
        n.id === nodeName ||
        (n as any).label === nodeName ||
        (n as any).name === nodeName ||
        n.data?.title === nodeName ||
        n.data?.name === nodeName ||
        n.data?.label === nodeName ||
        (n.data as any)?.displayName === nodeName
    );
    if (candidate && allNodeData?.[candidate.id] !== undefined) return candidate.id;
    return undefined;
  }

  function getValueByPath(targetData: any, cleanPath: string) {
    if (!cleanPath) return targetData;
    const keys = parsePath(cleanPath);
    let result: any = targetData;
    for (const key of keys) {
      if (result == null) return undefined;
      if (Array.isArray(result)) {
        if (typeof key === 'number' || (typeof key === 'string' && /^-?\d+$/.test(key))) {
          const n = typeof key === 'number' ? key : parseInt(key, 10);
          const idx = n >= 0 ? n : result.length + n;
          result = result[idx];
        } else {
          result = (result as any)[key as any];
        }
      } else {
        result = (result as any)[key as any];
      }
    }
    return result;
  }

  return expr.replace(templateRegex, (full, g1, g2, g3, rawPath) => {
    let targetData = inputData;
    const nodeName = (g1 || g2 || g3 || '').trim();

    if (nodeName && allNodeData) {
      const resolvedKey = resolveNodeKey(nodeName, allNodeData, nodes as any) || nodeName;
      if (allNodeData[resolvedKey] === undefined) return full;
      targetData = pickJsonSource(allNodeData[resolvedKey]);
    } else {
      targetData = pickJsonSource(targetData);
    }

    const cleanPath = (rawPath || '').trim().replace(/^[.\s]+/, '');

    if (!cleanPath) {
      const val = targetData;
      return typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
    }

    const value = getValueByPath(targetData, cleanPath);
    if (value === undefined) return null;

    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  });
}