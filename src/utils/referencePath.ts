export type PathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
    Array.isArray(value) &&
    value.every(
      (segment) =>
        typeof segment === "string" ||
        (typeof segment === "number" && Number.isSafeInteger(segment)),
    )
  );
}
