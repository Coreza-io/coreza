# Edit Fields: fix the crash and the broken drag-and-drop

Review of what is now in the tree, and the two defects that remain.

## What is implemented and looks right

- `coreza-backend/src/nodes/logic/editTemplate.ts` exists with segment-based compilation (`kind: "code"`, `expressionStart`) — the template layer landed.
- `typedEditFieldRow.ts` provides the shared `isTypedEditFieldRow` classifier.
- `EditFieldEditor` now has the typed Field Name / Type / Value Mode / Value controls, a debounced preview with a generation counter, and `onDrop` plus `onDragOver`/`onDragEnter` (with `preventDefault` and `dropEffect = "copy"`) on both the input and the textarea.
- `computeDropInsert` builds a correct reference: `{{ $("window").json.data[0].timestamp }}`, with bracket notation for numeric and non-identifier keys.

## Defect 1 — the panel crashes on render

`EditFieldEditor` calls `useRef` at `RepeaterNodeLayout.tsx:89`, but the React import on line 11 is still `import React, { useCallback, useState, useEffect, useMemo } from "react"`. Every render of the node throws `ReferenceError: useRef is not defined`, React unmounts the subtree, and nothing inside the panel works — including drop.

Fix: add `useRef` to that import.

## Defect 2 — array paths are malformed before the drop

The screenshot proves the native drop does fire: the `timestamp` chip appears in Value. The failure occurs earlier when `DraggableFieldsPanel.buildPath` constructs an array path. For `data → [0] → timestamp`, it returns `data.[0].timestamp` because line 42 always inserts a dot between parent and child. `computeDropInsert` then splits on dots and treats `"[0]"` as a quoted property name, producing a reference equivalent to `.data["[0]"].timestamp`. Arrays have index `0`, not property `"[0]"`, so preview resolves `undefined` and displays an empty string.

Fix the source path contract in `DraggableFieldsPanel.buildPath`: append numeric segments directly (`data[0]`), while object segments continue as `.name` or `["quoted key"]`. Then replace `computeDropInsert`'s dot-split parser with a shared path formatter/parser that preserves bracket indexes and quoted keys. This also fixes all other consumers of field dragging, not only Edit Fields.

Keep `nodrag` on the Edit Fields value controls as a defensive React Flow interaction guard, matching `NodeFieldRenderer`, but do not treat that as the root cause shown in the screenshot.

## Verification

After both changes, with the node open and an upstream node selected in the Input Data panel:

1. The Edit Fields panel renders with no console error.
2. A regression test confirms `DraggableFieldsPanel` emits `data[0].timestamp`, never `data.[0].timestamp`.
3. Dragging `timestamp` onto an empty Value inserts `{{ $("window").json.data[0].timestamp }}` and flips Value Mode to Expression.
4. The Result line shows the actual timestamp string, not `""`, proving the generated reference resolves.
5. Dragging into the middle of an existing `{{ ... }}` block inserts the bare reference, not a nested block.
6. Dragging into plain template text inserts a wrapped `{{ ... }}` block.
7. The caret lands after the inserted text and the field keeps focus.
8. Object keys containing dots, spaces or quotes and nested array indexes resolve correctly.

## Technical notes

The crash fix is confined to `RepeaterNodeLayout.tsx`. The path fix belongs in `DraggableFieldsPanel.tsx` plus the shared reference-path formatter used by `RepeaterNodeLayout.tsx`; add focused frontend tests. No backend or persisted-shape change is needed. Existing saved references with the historical `.[0]` form must remain readable by the generic resolver. The remaining items from the previous plan (manual-run `expressionContext` envelope for `POST /comparator/field`, typed-Fixed preservation scoping, loose-equality and slice semantics, typed persistence rejection) are unaffected and stay open.
