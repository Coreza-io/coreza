/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

type SliceObject = { type: "slice"; start: number | null; end: number | null };
type PathKey = string | number | SliceObject;

/**
 * Turn a path like "0.candles[1].value" or "['foo'].bar" into an array of keys/indexes.
 * Now supports negative numbers (e.g. -1, -2) and slice syntax (e.g. [0:10], [-5:], [:10]).
 */
function parsePath(path: string): PathKey[] {
  const parts: PathKey[] = [];
  // Match slice patterns [start:end] before single indices
  const regex = /([^[.\]]+)|\[(-?\d+)?:(-?\d+)?\]|\[(-?\d+|["'][^"']+["'])\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path))) {
    const [, dotKey, sliceStart, sliceEnd, bracketKey] = match;

    if (dotKey !== undefined) {
      parts.push(dotKey);
    } else if (sliceStart !== undefined || sliceEnd !== undefined) {
      // Slice pattern detected: [start:end], [:end], [start:], or [:]
      parts.push({
        type: "slice",
        start: sliceStart ? parseInt(sliceStart, 10) : null,
        end: sliceEnd ? parseInt(sliceEnd, 10) : null,
      });
    } else {
      // Single index or quoted key
      if (/^-?\d+$/.test(bracketKey!)) {
        parts.push(Number(bracketKey)); // e.g. "-1" → -1
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
  nodes?: any[],
): unknown {
  if (typeof expr !== "string") {
    return expr;
  }

  const templateRegex =
    /\{\{\s*(?:(?:\$\(\s*(?:'([^']+)'|"([^"]+)")\s*\)\s*\.json)|(?:\$node\[\s*(?:"([^"]+)"|'([^']+)')\s*\]\s*\.json)|(?:\$json))(?:(?:\s*\.\s*)|\s*)([^}]*)\s*\}\}/g;

  const pureTemplateRegex =
    /^\{\{\s*(?:(?:\$\(\s*(?:'([^']+)'|"([^"]+)")\s*\)\s*\.json)|(?:\$node\[\s*(?:"([^"]+)"|'([^']+)')\s*\]\s*\.json)|(?:\$json))(?:(?:\s*\.\s*)|\s*)([^}]*)\s*\}\}$/;

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

    for (const c of candidates) {
      if (c !== undefined) return c;
    }

    return d;
  }

  function resolveNodeKey(
    nodeName: string,
    allNodeData?: Record<string, any>,
    nodes?: Array<{ id: string; data?: any; label?: string; name?: string }>,
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
        (n.data as any)?.displayName === nodeName,
    );

    if (candidate && allNodeData?.[candidate.id] !== undefined) {
      return candidate.id;
    }

    return undefined;
  }

  function getValueByPath(targetData: any, cleanPath: string) {
    if (!cleanPath) return targetData;

    const keys = parsePath(cleanPath);
    let result: any = targetData;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];

      if (result == null) return undefined;

      if (typeof key === "object" && key.type === "slice") {
        if (!Array.isArray(result)) return undefined;

        const len = result.length;
        const start =
          key.start === null ? 0 : key.start < 0 ? len + key.start : key.start;
        const end =
          key.end === null ? len : key.end < 0 ? len + key.end : key.end;

        result = result.slice(start, end);

        const remainingKeys = keys.slice(i + 1);
        if (remainingKeys.length > 0) {
          result = result.map((item: any) => {
            let temp = item;

            for (const rKey of remainingKeys) {
              if (temp == null) return undefined;

              if (typeof rKey === "number") {
                temp = Array.isArray(temp)
                  ? temp[rKey >= 0 ? rKey : temp.length + rKey]
                  : temp[rKey];
              } else if (typeof rKey === "string") {
                temp = temp[rKey];
              } else if (typeof rKey === "object" && rKey?.type === "slice") {
                if (!Array.isArray(temp)) return undefined;

                const innerLen = temp.length;
                const innerStart =
                  rKey.start === null
                    ? 0
                    : rKey.start < 0
                      ? innerLen + rKey.start
                      : rKey.start;
                const innerEnd =
                  rKey.end === null
                    ? innerLen
                    : rKey.end < 0
                      ? innerLen + rKey.end
                      : rKey.end;

                temp = temp.slice(innerStart, innerEnd);
              } else {
                return undefined;
              }
            }

            return temp;
          });

          return result;
        }
      } else if (Array.isArray(result)) {
        if (
          typeof key === "number" ||
          (typeof key === "string" && /^-?\d+$/.test(key))
        ) {
          const n = typeof key === "number" ? key : parseInt(key, 10);
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

  function resolveSingleReference(
    nodeNameRaw: string | undefined,
    rawPath: string | undefined,
  ): unknown {
    let targetData = inputData;
    const nodeName = (nodeNameRaw || "").trim();

    if (nodeName && allNodeData) {
      const resolvedKey =
        resolveNodeKey(nodeName, allNodeData, nodes as any) || nodeName;

      if (allNodeData[resolvedKey] === undefined) {
        return undefined;
      }

      targetData = pickJsonSource(allNodeData[resolvedKey]);
    } else {
      targetData = pickJsonSource(targetData);
    }

    const cleanPath = (rawPath || "").trim().replace(/^[.\s]+/, "");

    if (!cleanPath) {
      return targetData;
    }

    return getValueByPath(targetData, cleanPath);
  }

  // No template at all -> undefined
  templateRegex.lastIndex = 0;
  if (!templateRegex.test(expr)) {
    return undefined;
  }

  // Pure expression: return raw value, missing path -> undefined
  const pureMatch = expr.match(pureTemplateRegex);
  if (pureMatch) {
    const [, g1, g1b, g2, g3, rawPath] = pureMatch;
    const nodeName = g1 || g1b || g2 || g3;
    const value = resolveSingleReference(nodeName, rawPath);

    if (value === undefined || value === null) return undefined;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  // Mixed/interpolated string: missing path -> "undefined"
  templateRegex.lastIndex = 0;
  return expr.replace(templateRegex, (full, g1, g1b, g2, g3, rawPath) => {
    const nodeName = g1 || g1b || g2 || g3;
    const value = resolveSingleReference(nodeName, rawPath);

    if (value === undefined || value === null) return "undefined";

    if (value instanceof Date) return value.toISOString();

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  });
}
