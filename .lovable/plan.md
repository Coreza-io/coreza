# Fix: drag-and-drop into Edit Fields values

## What's wrong

In the Edit Fields node, dragging a value from the Input Data panel onto the Value box does nothing.

Confirmed cause: the Value input and textarea in `EditFieldEditor` (`src/components/nodes/layout/RepeaterNodeLayout.tsx`, lines ~219-233) declare `onDrop` but no `onDragOver`. The browser only fires a drop event on an element whose `dragover` handler calls `preventDefault()`. Every other droppable field in the app does this — see `NodeFieldRenderer.tsx` lines 226-231, where `onDragOver` calls `preventDefault()` and sets `dropEffect = "copy"`, and both the input and textarea bind it (lines 409, 432).

So the Edit Fields editor is the only value box in the app missing that handler, which is exactly why it alone rejects drops.

## The fix

In `EditFieldEditor`:

1. Add a `onDragOver` handler that calls `event.preventDefault()`, `event.stopPropagation()` and sets `event.dataTransfer.dropEffect = "copy"`.
2. Bind it on both the `<textarea>` (expression / array / object modes) and the `<input>` (fixed scalar mode), alongside the existing `onDrop`.
3. Keep the existing caret-aware insertion in `onDrop` unchanged: it already inserts at `selectionStart`/`selectionEnd` and strips the `{{ }}` wrapper when the row is in Expression mode.
4. Also add `onDragEnter` with `preventDefault()` so drops register reliably in Chrome when the drag begins outside the dialog.

## Drop behaviour after the fix

- Expression mode: dropping `timestamp` inserts `$('window').json.timestamp` at the caret, and the Result preview re-evaluates after the existing 250 ms debounce.
- Fixed mode: dropping inserts the full `{{ $('window').json.timestamp }}` template, matching how every other fixed field behaves.
- Boolean fixed rows use a Select, so no drop target there — unchanged.

## Verification

- Drag a field from Input Data into a Fixed value box: template text appears at the caret.
- Switch the row to Expression, drag again: bare reference inserted, Result preview shows the resolved value.
- Drag into the middle of existing text: inserts at the caret rather than appending.

## Scope

One file, `src/components/nodes/layout/RepeaterNodeLayout.tsx`, presentation only. No backend or resolution-logic change.
