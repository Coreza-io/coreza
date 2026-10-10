import { parseLegacyPath } from "@/utils/referencePath";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { insertEditFieldReference, type ReferenceInsertion } from "@/utils/editFieldReferenceDrop";
import { isReferenceTextControl, textControlCaret, type ReferenceTextControl } from "@/utils/textControlCaret";

type Snapshot = { value: string; meta?: unknown; start: number; end: number; left: number; top: number };
type Owner = { control: () => ReferenceTextControl | null; capture: () => void; record: (insertion: ReferenceInsertion, meta?: unknown, beforeMeta?: unknown) => void; selection: () => Snapshot | null; reject: (message: string) => void; disabled: () => boolean };
const historyResets = new Set<() => void>();
export function resetReferenceTextHistory(): void { for (const reset of historyResets) reset(); }

const owners = new WeakMap<ReferenceTextControl, Owner>();
const eventControls = new WeakMap<Event, ReferenceTextControl>();
const focusRestores = new WeakSet<ReferenceTextControl>();
export function consumeReferenceFocusRestore(control: ReferenceTextControl): boolean {
  const present = focusRestores.has(control); focusRestores.delete(control); return present;
}
export function bindReferenceDropControl(event: React.DragEvent, control: ReferenceTextControl | null): void {
  if (isReferenceTextControl(control)) eventControls.set(event.nativeEvent, control);
}
export function referenceDropControl(event: React.DragEvent): ReferenceTextControl | null {
  const bound = eventControls.get(event.nativeEvent);
  if (bound) return bound;
  return isReferenceTextControl(event.currentTarget) ? event.currentTarget : null;
}

/** Shared final-drop transaction planner. No append or stale selection fallback. */
export function planReferenceTextDrop(event: React.DragEvent, reference: string, allowCode = false, typed = allowCode): ReferenceInsertion | null {
  const control = referenceDropControl(event);
  if (!control || control.disabled || control.readOnly || owners.get(control)?.disabled()) return null;
  const owner = owners.get(control);
  if (!typed) {
    const match = /^\{\{ \$\("([^"\\]*)"\)\.json(.*) \}\}$/.exec(reference);
    const segments = match ? parseLegacyPath(match[2]) : null;
    if (!segments || segments.some(segment => typeof segment === "string" && (!segment || /["'\\{}]/.test(segment)))) {
      owner?.reject("This key needs a typed expression field; the legacy reference grammar cannot represent its escapes.");
      return null;
    }
  }
  const point = textControlCaret(control, event.clientX, event.clientY);
  if (!point) { owner?.reject("Reference insertion needs a visible editable text control."); return null; }
  owner?.capture();
  const selected = owner?.selection();
  const replace = selected && selected.value === control.value && selected.start < selected.end && point.offset >= selected.start && point.offset < selected.end;
  const insertion = insertEditFieldReference(control.value, reference, replace ? selected.start : point.offset, replace ? selected.end : point.offset, allowCode);
  if (!insertion) owner?.reject("Place the reference in text or unquoted code; repair partial template boundaries first.");
  return insertion;
}
export function finishReferenceTextDrop(event: React.DragEvent, insertion: ReferenceInsertion, meta?: unknown, beforeMeta?: unknown): void {
  const control = referenceDropControl(event);
  if (control) owners.get(control)?.record(insertion, meta, beforeMeta);
}

/** Native field-local history includes typing/paste/IME and one transaction per reference drop. */
export function useReferenceTextDrop(options: {
  value: string;
  onChange: (value: string) => boolean | void;
  meta?: unknown;
  onRestore?: (value: string, meta: unknown) => boolean | void;
  disabled?: boolean;
  identity?: unknown;
}) {
  const [error, setError] = useState<string>();
  const controlRef = useRef<ReferenceTextControl | null>(null);
  const latest = useRef(options); latest.current = options;
  const selected = useRef<Snapshot | null>(null);
  const historyMeta = useRef<unknown>();
  const history = useRef<{ undo: Snapshot[]; redo: Snapshot[] }>({ undo: [], redo: [] });
  const expected = useRef(options.value);
  const expectedMeta = useRef(options.meta);
  const pending = useRef<Snapshot | null>(null);
  const composing = useRef<Snapshot | null>(null);
  const frame = useRef<number>();
  const caret = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef<(redo?: boolean) => void>(() => {});
  const snapshot = (): Snapshot => {
    const control = controlRef.current;
    return { value: latest.current.value, meta: latest.current.meta ?? historyMeta.current, start: control?.selectionStart ?? 0, end: control?.selectionEnd ?? 0, left: control?.scrollLeft ?? 0, top: control?.scrollTop ?? 0 };
  };
  const clearCaret = () => { if (frame.current !== undefined) cancelAnimationFrame(frame.current); frame.current = undefined; caret.current?.remove(); caret.current = null; };
  const capture = () => {
    const control = controlRef.current;
    if (control && document.activeElement === control) selected.current = snapshot();
  };
  const record = (before: Snapshot, after: Snapshot) => {
    if (before.value === after.value && before.meta === after.meta) return;
    history.current.undo.push(before);
    if (history.current.undo.length > 100) history.current.undo.shift();
    history.current.redo = []; expected.current = after.value; expectedMeta.current = after.meta; pending.current = after;
  };
  const restore = () => {
    const state = pending.current, control = controlRef.current;
    pending.current = null;
    if (!state || !control || control.value !== state.value || latest.current.disabled) return;
    if (document.activeElement !== control) focusRestores.add(control);
    control.focus({ preventScroll: true });
    if (isReferenceTextControl(control)) control.setSelectionRange(state.start, state.end);
    control.scrollLeft = state.left; control.scrollTop = state.top;
    selected.current = state;
  };
  const owner: Owner = {
    control: () => controlRef.current,
    capture, selection: () => selected.current,
    disabled: () => !!latest.current.disabled,
    reject: setError,
    record: (insertion, meta, beforeMeta) => {
      setError(undefined);
      record({ ...snapshot(), meta: beforeMeta ?? snapshot().meta }, { ...snapshot(), value: insertion.value, meta: meta ?? snapshot().meta, start: insertion.caret, end: insertion.caret });
      historyMeta.current = meta ?? historyMeta.current;
      clearCaret(); requestAnimationFrame(restore);
    },
  };
  useLayoutEffect(() => {
    const control = controlRef.current;
    if (control) owners.set(control, owner);
    const beforeInput = (event: InputEvent) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault(); event.stopPropagation(); undoRef.current(event.inputType === "historyRedo");
      } else capture();
    };
    control?.addEventListener("beforeinput", beforeInput);
    if (options.value !== expected.current || (options.meta !== undefined && options.meta !== expectedMeta.current)) {
      history.current = { undo: [], redo: [] }; historyMeta.current = undefined; selected.current = null; pending.current = null;
      expected.current = options.value; expectedMeta.current = options.meta;
    }
    restore();
    return () => { if (control) owners.delete(control); control?.removeEventListener("beforeinput", beforeInput); };
  });
  useEffect(() => {
    history.current = { undo: [], redo: [] }; historyMeta.current = undefined; selected.current = null; pending.current = null;
  }, [options.identity]);
  useEffect(() => {
    const reset = () => { history.current = { undo: [], redo: [] }; historyMeta.current = undefined; selected.current = null; pending.current = null; composing.current = null; clearCaret(); };
    historyResets.add(reset);
    return () => { historyResets.delete(reset); };
  }, []);
  useEffect(() => {
    const cleanup = () => { clearCaret(); document.body.classList.remove("cursor-grabbing", "select-none"); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") cleanup(); };
    document.addEventListener("dragend", cleanup); document.addEventListener("drop", cleanup); document.addEventListener("keydown", escape);
    return () => { cleanup(); document.removeEventListener("dragend", cleanup); document.removeEventListener("drop", cleanup); document.removeEventListener("keydown", escape); };
  }, []);
  useEffect(() => { if (options.disabled) clearCaret(); }, [options.disabled]);
  const undo = (redo = false) => {
    if (latest.current.disabled || composing.current) return;
    const from = redo ? history.current.redo : history.current.undo, to = redo ? history.current.undo : history.current.redo;
    const state = from.pop(); if (!state) return;
    to.push(snapshot()); expected.current = state.value; expectedMeta.current = state.meta; pending.current = state;
    const accepted = latest.current.onRestore
      ? latest.current.onRestore(state.value, state.meta)
      : latest.current.onChange(state.value);
    if (accepted === false) { from.push(state); to.pop(); expected.current = latest.current.value; expectedMeta.current = latest.current.meta; pending.current = null; return; }
    if (!latest.current.onRestore) {
      const meta = state.meta as { restore?: () => void } | undefined;
      meta?.restore?.();
    }
    historyMeta.current = state.meta;
  };
  undoRef.current = undo;
  return {
    controlRef,
    error,
    bind: (event: React.DragEvent) => bindReferenceDropControl(event, controlRef.current),
    clearCaret,
    props: {
      onSelect: capture,
      onBlur: () => { if (controlRef.current) selected.current = snapshot(); },
      onChange: (event: React.ChangeEvent<ReferenceTextControl>) => {
        if (latest.current.disabled) return;
        const before = selected.current?.value === latest.current.value ? selected.current : snapshot();
        const after = { ...snapshot(), value: event.target.value, start: event.target.selectionStart ?? 0, end: event.target.selectionEnd ?? 0 };
        if (latest.current.onChange(after.value) === false) { event.target.value = latest.current.value; return; }
        if (!composing.current) record(before, after);
        else expected.current = after.value;
        selected.current = after;
      },
      onCompositionStart: () => { composing.current = snapshot(); },
      onCompositionEnd: () => { if (composing.current) record(composing.current, snapshot()); composing.current = null; },
      onKeyDown: (event: React.KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
          event.preventDefault(); event.stopPropagation(); undo(event.shiftKey || event.key.toLowerCase() === "y");
        }
      },
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault(); event.stopPropagation();
        if (!Array.from(event.dataTransfer.types).includes("application/reactflow") || latest.current.disabled) { clearCaret(); return; }
        event.dataTransfer.dropEffect = "copy";
        const x = event.clientX, y = event.clientY;
        if (frame.current !== undefined) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          const control = controlRef.current;
          if (!control) return;
          capture();
          const rect = control.getBoundingClientRect();
          if (control instanceof HTMLTextAreaElement) {
            if (y < rect.top + 12) control.scrollTop -= 12;
            if (y > rect.bottom - 12) control.scrollTop += 12;
          }
          const point = textControlCaret(control, x, y);
          if (!point) { clearCaret(); return; }
          const marker = caret.current ?? document.createElement("div");
          if (!caret.current) { marker.setAttribute("aria-hidden", "true"); marker.dataset.referenceCaret = "true"; document.body.append(marker); caret.current = marker; }
          Object.assign(marker.style, { position: "fixed", pointerEvents: "none", zIndex: "10000", width: "2px", background: "var(--node-neon-color, #22d3ee)", left: `${point.x}px`, top: `${point.y}px`, height: `${point.height}px` });
        });
      },
      onDragLeave: (event: React.DragEvent) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clearCaret(); },
    },
  };
}
