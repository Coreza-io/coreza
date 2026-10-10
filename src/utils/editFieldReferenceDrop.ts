export interface ReferenceInsertion {
  value: string;
  caret: number;
}

type Span = { kind: "text" | "code" | "string" | "delimiter" | "ambiguous"; start: number; end: number };

/** Tolerant authoring lexer. Offsets are UTF-16; evaluation still uses the strict compiler. */
export function referenceInsertionSpans(value: string): { spans: Span[]; templates: { start: number; end: number }[] } {
  const spans: Span[] = [], templates: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf("{{", cursor);
    const textEnd = open < 0 ? value.length : open;
    for (let i = cursor; i < textEnd;) {
      const start = i, kind = /[{}]/.test(value[i]) ? "ambiguous" : "text";
      while (++i < textEnd && (/[{}]/.test(value[i]) ? "ambiguous" : "text") === kind) { /* span */ }
      spans.push({ kind, start, end: i });
    }
    if (open < 0) break;
    spans.push({ kind: "delimiter", start: open, end: open + 2 });
    let i = open + 2, codeStart = i;
    const brackets: string[] = [];
    let closed = false;
    for (; i < value.length;) {
      const char = value[i];
      if (char === '"' || char === "'") {
        if (i > codeStart) spans.push({ kind: "code", start: codeStart, end: i });
        const start = i++, quote = char;
        let quoteClosed = false;
        while (i < value.length) {
          if (value[i] === "\\") { i = Math.min(i + 2, value.length); continue; }
          if (value[i++] === quote) { quoteClosed = true; break; }
        }
        spans.push({ kind: quoteClosed ? "string" : "ambiguous", start, end: i });
        codeStart = quoteClosed ? i : value.length + 1; continue;
      }
      if (char === "}" && value[i + 1] === "}" && brackets.length === 0) {
        spans.push({ kind: "code", start: codeStart, end: i });
        spans.push({ kind: "delimiter", start: i, end: i + 2 });
        templates.push({ start: open, end: i + 2 });
        cursor = i + 2; closed = true; break;
      }
      if (char === "{" || char === "}" || ((char === ")" || char === "]") && brackets.pop() !== (char === ")" ? "(" : "["))) {
        if (i > codeStart) spans.push({ kind: "code", start: codeStart, end: i });
        spans.push({ kind: "ambiguous", start: i, end: value.length });
        i = value.length; codeStart = i + 1; break;
      }
      if (char === "(" || char === "[") brackets.push(char);
      i++;
    }
    if (!closed) {
      if (codeStart <= value.length) spans.push({ kind: "code", start: codeStart, end: value.length });
      cursor = value.length;
    }
  }
  return { spans, templates };
}

export function insertEditFieldReference(
  value: string,
  reference: string,
  selectionStart = value.length,
  selectionEnd = selectionStart,
  allowCode = true,
): ReferenceInsertion | null {
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd) || selectionStart < 0 || selectionEnd < selectionStart || selectionEnd > value.length) return null;
  const referenceMatch = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(reference);
  if (!referenceMatch) return null;
  const { spans, templates } = referenceInsertionSpans(value);
  const start = selectionStart, end = selectionEnd;
  const whole = templates.some(template => template.start === start && template.end === end);
  let code = false;
  if (!whole) {
    // Positions immediately before an opening pair/after a closing pair are text.
    // Immediately after opening/before closing are code, including unfinished code.
    const span = spans.find(s => s.kind === "code" && start >= s.start && end <= s.end)
      ?? spans.find(s => s.kind === "text" && start >= s.start && end <= s.end);
    if (span) code = span.kind === "code";
    else if (start === end && (value.length === 0 || templates.some(t => start === t.start || start === t.end) || spans.some(s => s.kind === "delimiter" && s.start === start && value.slice(start, start + 2) === "{{"))) code = false;
    else return null;
    if (code && !allowCode) return null;
  }
  const inserted = code ? referenceMatch[1] : reference;
  return { value: value.slice(0, start) + inserted + value.slice(end), caret: start + inserted.length };
}
