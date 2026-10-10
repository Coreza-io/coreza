export type ReferenceTextControl = HTMLInputElement | HTMLTextAreaElement;
const textTypes = new Set(["text", "search", "url", "tel"]);
export function isReferenceTextControl(element: unknown): element is ReferenceTextControl {
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && textTypes.has(element.type));
}

/** Chromium LTR native-control geometry, measured in CSS pixels before outer scaling. */
export function textControlCaret(control: ReferenceTextControl, clientX: number, clientY: number): { offset: number; x: number; y: number; height: number } | null {
  if (!isReferenceTextControl(control) || !control.isConnected || control.disabled || control.readOnly || control.value.length > 8192) return null;
  const rect = control.getBoundingClientRect(), style = getComputedStyle(control);
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
  if (!rect.width || !rect.height || !control.offsetWidth || !control.offsetHeight || style.direction !== "ltr" || style.writingMode !== "horizontal-tb") return null;
  const scaleX = rect.width / control.offsetWidth, scaleY = rect.height / control.offsetHeight;
  const mirror = document.createElement("div");
  const properties = ["boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight", "letterSpacing", "textIndent", "textTransform", "textAlign", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "wordSpacing", "overflowWrap", "wordBreak"] as const;
  for (const property of properties) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: "fixed", left: "-10000px", top: "0", width: `${style.boxSizing === "border-box" ? control.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) : control.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px`, borderStyle: "solid", borderColor: "transparent", visibility: "hidden", pointerEvents: "none", whiteSpace: control instanceof HTMLTextAreaElement ? "pre-wrap" : "pre", overflow: "visible" });
  const text = document.createTextNode(control.value + "\u200b");
  mirror.append(text); document.body.append(mirror);
  try {
    const bounds = mirror.getBoundingClientRect();
    const targetX = (clientX - rect.left) / scaleX + control.scrollLeft;
    const targetY = (clientY - rect.top) / scaleY + control.scrollTop;
    const offsets: number[] = [0];
    // Intl.Segmenter preserves surrogate pairs, combining marks and emoji sequences.
    const Segmenter = (Intl as unknown as { Segmenter?: new(locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ index: number; segment: string }> } }).Segmenter;
    if (Segmenter) for (const segment of new Segmenter(undefined, { granularity: "grapheme" }).segment(control.value)) offsets.push(segment.index + segment.segment.length);
    else for (const char of control.value) offsets.push(offsets[offsets.length - 1] + char.length);
    const range = document.createRange();
    const measure = (index: number) => {
      range.setStart(text, offsets[index]);
      // A collapsed range at a soft wrap belongs to the previous line in Chromium.
      // Measure the following grapheme instead to place the caret on the target line.
      range.setEnd(text, offsets[index + 1] ?? text.length);
      const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      return { x: r.left - bounds.left, endX: r.right - bounds.left, y: r.top - bounds.top, height: r.height || parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 };
    };
    // Locate the line first, then its nearest grapheme boundary. Measurements stay bounded.
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2), p = measure(mid); if (targetY >= p.y + p.height) lo = mid + 1; else hi = mid; }
    const line = measure(lo);
    let first = lo, last = lo;
    while (first > 0 && Math.abs(measure(first - 1).y - line.y) < 1) first--;
    while (last + 1 < offsets.length && Math.abs(measure(last + 1).y - line.y) < 1) last++;
    let best = first, distance = Infinity;
    for (let i = first; i <= last; i++) { const p = measure(i), d = Math.abs(p.x - targetX); if (d < distance) { distance = d; best = i; } }
    let p = measure(best), offset = offsets[best];
    const end = measure(last);
    if (Math.abs(end.endX - targetX) < distance) {
      offset = offsets[last + 1] ?? control.value.length;
      p = { ...end, x: end.endX };
    }
    return { offset, x: rect.left + (p.x - control.scrollLeft) * scaleX, y: rect.top + (p.y - control.scrollTop) * scaleY, height: p.height * scaleY };
  } finally { mirror.remove(); }
}
