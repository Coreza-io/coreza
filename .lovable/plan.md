# Edit Fields: D1-D9 correction plan

Adopting the fix document. Each defect below was re-confirmed against the current tree before being planned.

## Batch 1 — authoring and references (P1)

**D1 — dragged references corrupt array indexes.** `DraggableFieldsPanel.buildPath` joins with a dot unconditionally, so `data → [0] → timestamp` becomes `data.[0].timestamp`; `computeDropInsert` then splits on dots and quotes `"[0]"` as a property, yielding `.json.data["[0]"].timestamp`.

- Add one shared path utility with a `PathSegment = string | number` representation and a single `formatPath` that emits `[0]` for numeric indexes, `.name` for identifiers and `[JSON.stringify(key)]` otherwise.
- `buildPath` appends bracket segments directly and carries segment types, so an object key `"01"` stays a string while a real array index stays a number.
- `computeDropInsert` consumes structured `pathSegments` from the drag payload and formats once; keep a validated `keyPath` parse as fallback for older payloads.
- Include the source node id in the drag payload so a panel-selection change during the drag cannot rewrite the reference's identity.
- Legacy stored references using `.[0]` must remain readable through the existing resolver.

**D2 — insertion fails while the expression is incomplete.** `onDrop` compiles the whole current value before inserting, so unclosed braces or a half-written operand throw and the drop is silently discarded. Wrap the compile in a guard: on a compile error, fall back to plain caret insertion of the wrapped reference rather than aborting.

**D4 — changing Type destroys the authored source.** Selecting Boolean overwrites `value` with `"false"` whenever the text isn't exactly `true`/`false`. Keep the source text on every type change; surface the mismatch through the existing type-error line instead. Only seed a default when the value is empty.

Exit check: a real browser drop into empty and unfinished fields works, and the source text survives every type change.

## Batch 2 — execution parity (P1)

**D3 — manual runs evaluate against empty input.** `buildPayload` now sends `expressionContext` but never sets `payload.data`; the route destructures `data = {}`, so `$json` and bare aliases are empty and a condition can flip. Send the effective selected input as `payload.data` and assert parity against preview and engine execution.

**D5 — legacy rows are unusable when mixed.** The typed editor renders whenever `conditions.some(isTypedEditFieldRow)`, so a legacy Set/Copy/Remove row inside a mixed array is drawn with typed controls and cannot be edited correctly. Decide rendering per row, not per array: typed rows get the typed editor, legacy rows keep the operator controls.

Exit check: manual, preview and workflow agree; legacy rows display, edit, save, reload and execute unchanged.

## Batch 3 — value and safety semantics (P2)

- **D6** — separate ordinary array property access from slice projection: `bars.length` → `2`, `bars["0"].Close` → first close, `bars[-1].Close` → last close, and only an explicit slice such as `bars[-2:].Close` projects over elements. Represent the distinction in the AST.
- **D7** — split typed-row detection from validation. A row carrying the new keys with an invalid `dataType` must raise a structured configuration error, not fall through to legacy handling and be skipped.
- **D8** — Fixed Number must reject `null`, Booleans and objects rather than coercing them to `0`.
- **D9** — validate destination keys before assignment: reject `__proto__`, `prototype` and `constructor`, and build the result on a null-prototype accumulator with explicit own-property definition. Pre-validate all row configurations before executing any row so a malformed later row cannot land after an earlier legacy side effect. Keep the existing rejection of typed persistence.

## Batch 4 — tests and gates

- Fix `tests/utils/editFieldsParameterResolution.test.ts`: a Fixed `{{ $json.close }}` stays the literal string under the planned Fixed semantics, so the `120` expectation is wrong. Add a Fixed String execution assertion and a Fixed Number case that fails numeric validation.
- Regression coverage: real browser drop (asserting persisted source and evaluated value, not the drag ghost) across root arrays, nested arrays and keys with dots, spaces, quotes and backslashes; unfinished braces, selections, boundary insertion and caret restoration; transport parity through `/comparator/field`; legacy, mixed and malformed rows; evaluator array/index/slice, null guards, zero and false rendering, mixed templates; BOS repeated with changed bars in normal and compiled paths with a named upstream reference.
- Confirm the runner split before running: the parameter-resolution test imports Vitest while the backend suites use Jest globals.

**Done when:** D1-D9 have passing regressions, the screenshot fixture inserts `{{ $("window").json.data[0].timestamp }}` and previews the real timestamp, the BOS signal agrees across preview/manual/workflow, legacy rows stay editable, and no configuration failure silently changes a signal.
