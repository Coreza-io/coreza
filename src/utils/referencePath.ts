import { nodeReferenceName, type ReferenceNode } from "./referenceResolution";

export type PathSegment = string | number;

export interface JsonReferenceDragPayload {
  type: "jsonReference";
  keyPath: string;
  pathSegments: PathSegment[];
  sourceNodeId?: string;
  value: string;
  variableKey?: string;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function createJsonReferenceDragPayload(
  pathSegments: PathSegment[],
  sourceNodeId: string | undefined,
  value: string,
): JsonReferenceDragPayload {
  return {
    type: "jsonReference",
    keyPath: formatPath(pathSegments).replace(/^\./, ""),
    pathSegments,
    sourceNodeId,
    value,
  };
}

export function parseJsonReferenceDragPayload(
  raw: string,
): JsonReferenceDragPayload | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const payload = value as Record<string, unknown>;
    if (
      payload.type !== "jsonReference" ||
      (payload.variableKey !== undefined && (typeof payload.variableKey !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(payload.variableKey) || ["__proto__", "constructor", "prototype"].includes(payload.variableKey))) ||
      (payload.sourceNodeId !== undefined &&
        (typeof payload.sourceNodeId !== "string" || !payload.sourceNodeId))
    )
      return null;
    if (payload.pathSegments !== undefined && !isPathSegments(payload.pathSegments)) return null;
    const pathSegments = isPathSegments(payload.pathSegments)
      ? payload.pathSegments
      : parseLegacyPath(
          typeof payload.keyPath === "string" ? payload.keyPath.trim() : "",
        );
    if (!pathSegments || !isPathSegments(pathSegments)) return null;
    const sourceNodeId =
      typeof payload.sourceNodeId === "string"
        ? payload.sourceNodeId
        : undefined;
    return {
      ...createJsonReferenceDragPayload(pathSegments, sourceNodeId, typeof payload.value === "string" ? payload.value : ""),
      ...(typeof payload.variableKey === "string" ? { variableKey: payload.variableKey } : {}),
    };
  } catch {
    return null;
  }
}

export function formatPath(segments: readonly PathSegment[]): string {
  return segments
    .map((segment) =>
      typeof segment === "number"
        ? `[${segment}]`
        : IDENTIFIER.test(segment)
          ? `.${segment}`
          : `[${JSON.stringify(segment)}]`,
    )
    .join("");
}

/** Parses paths emitted by older drag payloads, including the historical `.[0]` form. */
export function parseLegacyPath(path: string): PathSegment[] | null {
  const segments: PathSegment[] = [];
  let cursor = 0;
  while (cursor < path.length) {
    if (path[cursor] === ".") cursor++;
    if (cursor >= path.length) return null;
    if (path[cursor] === "[") {
      let end = cursor + 1;
      let quote: '"' | null = null;
      let escaped = false;
      for (; end < path.length; end++) {
        const character = path[end];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (quote && character === "\\") {
          escaped = true;
          continue;
        }
        if (character === '"') {
          quote = quote ? null : '"';
          continue;
        }
        if (!quote && character === "]") break;
      }
      if (end >= path.length || quote || escaped) return null;
      const contents = path.slice(cursor + 1, end);
      if (/^-?\d+$/.test(contents)) segments.push(Number(contents));
      else {
        try {
          const key: unknown = JSON.parse(contents);
          if (typeof key !== "string") return null;
          segments.push(key);
        } catch {
          return null;
        }
      }
      cursor = end + 1;
      continue;
    }
    const match = path.slice(cursor).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match) return null;
    segments.push(match[0]);
    cursor += match[0].length;
    if (cursor < path.length && path[cursor] !== "." && path[cursor] !== "[")
      return null;
  }
  return segments;
}

export function isPathSegments(value: unknown): value is PathSegment[] {
  return (
    Array.isArray(value) && value.length <= 32 &&
    value.every(
      (segment) =>
        (typeof segment === "string" && segment.length <= 1000) ||
        (typeof segment === "number" && Number.isSafeInteger(segment)),
    )
  );
}

/** Resolve the current canonical source before choosing a readable, unambiguous selector. */
export function buildNodeReference(
  payload: JsonReferenceDragPayload,
  nodes: readonly ReferenceNode[],
  selectedSourceId?: string,
): string | null {
  const id = payload.sourceNodeId ?? selectedSourceId;
  const source = nodes.find((node) => node.id === id);
  if (!source || source.id.toLowerCase().startsWith("__cluster__")) return null;
  if (payload.variableKey) return `{{ $vars${formatPath([payload.variableKey])} }}`;
  return `{{ $(${JSON.stringify(nodeReferenceName(source, nodes))}).json${formatPath(payload.pathSegments)} }}`;
}
