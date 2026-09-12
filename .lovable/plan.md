# Edit Fields review and remaining drag/drop correction

## Review outcome

Static review confirms D1-D9 are implemented in the current tree:

- **D1:** structured path segments and legacy-path fallback now preserve array indexes and quoted keys.
- **D2:** insertion tolerates incomplete expressions.
- **D3:** manual Edit Fields requests now send the selected input as `payload.data`.
- **D4:** changing Type preserves non-empty authored source.
- **D5:** typed versus legacy controls are selected per row, so mixed arrays remain editable.
- **D6:** ordinary array members/indexes are separated from explicit slice projection.
- **D7:** malformed typed-shaped rows are rejected before execution.
- **D8:** Fixed Number rejects null, Boolean, array and object values.
- **D9:** unsafe destination names are rejected before writes, and result maps use own-property assignment on null-prototype objects.

The existing unit coverage confirms most of these behaviors. Two release checks remain incomplete: a real browser drag test and full preview/manual/workflow parity through the HTTP route.

## Confirmed remaining drag/drop difference

The If node works because `NodeFieldRenderer` treats the complete value area as a drop zone: both its wrapper and input receive drag handlers, and drag-over calls both `preventDefault()` and `stopPropagation()`.

Typed Edit Fields bypasses `NodeFieldRenderer` and uses `EditFieldEditor`. Its handlers exist only on the raw input/textarea, drag-over does not stop propagation, and Fixed Boolean renders a Select with no drop handlers. The screenshot showing plain selected text such as `high` is consistent with the browser's native text drop rather than Coreza inserting a `{{ ... }}` reference.

There is also a state defect: Edit Fields switches to Expression only when the old value is empty. Dropping onto a non-empty Fixed value inserts expression source but leaves it in Fixed mode, so it is treated as literal text.

## Implementation plan

### 1. Use one reusable reference drop target

- Extract or reuse the working `NodeFieldRenderer` drop-zone behavior instead of maintaining an Edit Fields-only variant.
- Wrap the Edit Fields Value control in `className="nodrag"` and attach `onDragEnter`, `onDragOver`, and `onDrop` to the wrapper as well as the editable input/textarea.
- On drag enter/over, call `preventDefault()` and `stopPropagation()`, then set `dropEffect = "copy"` so the React Flow canvas cannot claim the event.
- Route input, textarea and Boolean controls through the same wrapper. A drop on the label, control padding or Boolean selector must reach the same handler.
- Keep the target stable across Fixed/Expression and data-type changes so a drag cannot lose its destination during re-render.

### 2. Make drop semantics deterministic

- Parse the `application/reactflow` payload once at the shared drop boundary.
- Reject non-reference payloads; never fall through to browser-native text insertion.
- Always set `valueMode: "expression"` after a valid field drop, including when the previous Fixed value is non-empty.
- Preserve caret-aware replacement for text controls. If no valid selection exists, append predictably rather than inserting at an accidental offset.
- Continue using the shared structured path formatter, producing `{{ $("window").json.data[0].high }}` for the screenshot fixture.
- Clean up drag cursor classes on successful, rejected and cancelled drags.

### 3. Remove source-payload ambiguity

- `DraggableFieldsPanel` currently writes the rich payload, then calls `useNodeReferences.handleDragStart`, which writes the same MIME type again with a reduced legacy payload. Change this to one owner for `application/reactflow` so `pathSegments` and `sourceNodeId` cannot be overwritten.
- Keep the callback only for shared drag UI state, or pass the full payload through it without rewriting the MIME entry.
- Add a stable plain-text fallback only for browser interoperability; Edit Fields must prefer and validate the structured MIME payload.

### 4. Add regression coverage

- Unit-test the final drag payload after the complete `DraggableFieldsPanel` callback sequence, asserting that `pathSegments` and `sourceNodeId` survive.
- Component-test Edit Fields drops onto input, textarea, wrapper padding and Boolean controls in both Fixed and Expression modes.
- Assert that browser-native text such as `high` is never persisted by itself.
- Verify empty, non-empty, selected-range and incomplete-expression insertion plus caret restoration.
- Browser-test the actual Input Data panel → Edit Fields interaction and compare it with If using the same field.
- Assert persisted source and preview value, not merely the drag ghost: `{{ $("window").json.data[0].high }}` must preview `27` for the supplied fixture.

### 5. Finish release verification

- Run the focused path, editor, evaluator, Edit Fields route and parameter-resolution suites with their configured Vitest/Jest runners.
- Run frontend node validation/build and backend build.
- Compare the same expression across preview, manual Execute and workflow execution, including a named upstream node and changed bar input.

## Definition of done

Dragging any Input Data field onto any Edit Fields Value area always inserts a valid reference, switches the row to Expression, previews the real value and persists the source. The same gesture remains working in If, D1-D9 regressions pass, and preview/manual/workflow outputs agree.