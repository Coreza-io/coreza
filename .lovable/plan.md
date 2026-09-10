# Edit Fields: n8n-style expression contract — remaining implementation

The document's contract is sound and most of it is already partly built (`safeExpression.ts`, `editFields.ts`, typed rows in `Field.json`, the `EditFieldEditor` UI). This plan covers only the verified gaps between what exists today and what the document specifies, plus the fixes it correctly calls out.

## Verified current state

- `evaluateExpression` (`coreza-backend/src/nodes/logic/safeExpression.ts:490`) strips a template with `text.match(/^\s*\{\{([\s\S]*)\}\}\s*$/)` and evaluates the remainder. This is exactly the "strip the first and last braces" shortcut the document rejects. There is no template scanner, so `{{ a }} > {{ b }}` is mis-parsed instead of becoming the string `105 > 100`, and leading/trailing text is silently discarded.
- The grammar has no bare-identifier alias (`last_high`, `current_bar.Close` throw "Identifier is not allowed"), no `undefined` literal, no string `+` concatenation, and no slice/negative-index support — `[-1]` parses but `evaluate` does a `hasOwnProperty(String(key))` lookup, so it always yields `undefined`.
- `==`/`!=` are mapped to `===`/`!==` in `evaluate`, which the document explicitly forbids.
- Typed-row preservation exists in `parameterResolver.resolveDeep`, `templateCompiler.compileValue` and `useNodeExecution.resolveDeep`, but only for `valueMode === "expression"`. Typed **Fixed** rows still pass through `resolveReferences`, so a literal `{{ ... }}` in a Fixed value gets resolved. None of the three checks are scoped to an Edit Fields `fields` row.
- `POST /comparator/field` reads `getPersistentValue`/`setPersistentValue`/`getAllNodeResults` off `req.body.context`. Over HTTP these are never functions, so manual runs evaluate with an empty `$nodes` — named-node references silently return `undefined`. `useNodeExecution.buildPayload` builds an `allNodeData` map but never sends it.
- The `EditFieldEditor` Value input/textarea declare `onDrop` but no `onDragOver`, so the browser never fires the drop. This is why drag-and-drop into Edit Fields does nothing.
- `applyFieldRows` writes typed rows through `setPersistentValue` even though the modern execution context supplies no persistence bridge.

## 1. Template layer (shared core)

New `compileEditTemplate(source)` / `evaluateEditTemplate(compiled, context)` beside `safeExpression.ts`, exported from a pure subtree the frontend already imports from.

- Lexer-aware scanner splits a source into text and code segments, tracking string quotes, escapes and bracket nesting so a `}}` inside `'a }} b'` is not a delimiter.
- Exactly one code segment and no surrounding text → return the native value with its type intact.
- Any other shape → assemble a string: `null`/`undefined` render as empty text, `0` and `false` render literally, arrays/objects use bounded JSON. Text outside braces is never re-parsed as code.
- No braces at all in expression mode → the literal text, as a string.
- Unclosed or nested delimiters raise a clear error with a character position; literal braces are entered via Fixed mode.
- Cache compiled templates by source string only, never data or results. Enforce limits during scanning/parsing: 8 KiB source, depth 32, 1024 AST nodes, 32 path steps, 64 segments, 256 KiB rendered output.

`evaluateExpression` keeps its current signature for the If/Switch callers; the brace-stripping regex is removed and those callers pass bare code.

## 2. Expression language corrections

In the existing parser/evaluator:

- Bare identifiers resolve as own properties of `$json` (so `last_high` and `current_bar.Close` work), after reserved words and literals. Never search persistence, globals or upstream nodes.
- Add an `undefined` literal.
- `+` accepts two numbers or two strings; other arithmetic stays numbers-only.
- `==`/`!=` implement JS primitive loose equality including `null == undefined`; object operands are rejected. `===`/`!==` unchanged.
- Implement negative indexes and slices (`[-1]`, `[-5:]`, `[0:5]`, `[:]`) as explicit path nodes matching `resolveReferences` behaviour, including projection such as `bars[-5:].Close`.
- Preserve an explicit `null` distinctly from a missing path (`undefined`).
- Keep the existing prototype/call/assignment rejections; extend the tests to computed bracket spellings of `__proto__`, `prototype`, `constructor`.

## 3. Typed row plumbing

- Add one shared `isTypedEditFieldRow(row)` classifier and use it in `parameterResolver.resolveDeep`, `templateCompiler.compileValue` and `useNodeExecution.resolveDeep`, scoped to an Edit Fields `fields` array rather than any object carrying `valueMode`.
- Preserve **both** Fixed and Expression `right`/`value` verbatim; only the typed helper interprets them. Field names, `dataType` and `valueMode` are configuration and skip template resolution.
- In `templateCompiler`, detect expression-mode rows before the "no braces" early return so brace-free expression text still routes to the node-aware fallback.
- Confirm whether nodes carrying typed expression rows stay eligible for the compiled backtest plan. If they must fall back, measure and report the backtest speed impact for the whole affected workflow — not just the row.

## 4. Execution wiring

- Extract the typed-row half of `applyFieldRows` into a small shared applicator used by both `ControlFlowExecutor.executeFieldNode` and `POST /comparator/field`, so both paths produce identical values, types and errors. Legacy rows keep their existing loop, seed and Copy/Remove behaviour untouched.
- Engine path: build context from the real `input`, `context.nodes` and `context.getAllNodeResults()`, resolving referenced upstream results lazily.
- Manual path: `buildPayload` sends a serialisable `expressionContext: { nodeResults, nodeIdentities }` containing only the sources the compiled template actually references. The route validates that envelope and builds its own lookups — it never calls anything under `req.body.context`.
- Evaluate every typed row against the same input snapshot; apply in row order; last duplicate name wins; a typed row cannot read an earlier typed assignment.
- Errors return node id, row index, field name, phase, character position, expected and actual type through the standard error envelope. A failed evaluation is never returned as a field value or as `false`.

## 5. Persistence boundary

For this release, typed rows do not support persistence: reject enabling `persistent` on a node containing typed rows, and reject imported typed+persistent combinations before any execution or write. Remove the typed-row `setPersistentValue` call. Legacy persistent rows keep their existing path. Call this limitation out explicitly in the PR.

## 6. UI: preview and drag-and-drop

- `EditFieldEditor` preview switches to the shared template evaluator and shows value, actual type and the type error separately, e.g. `Result: "105 > 100" · String — expected Boolean`. Keep `false`, `0`, `""`, `null` and "no data" as visibly distinct states. Keep the 200-250 ms debounce and add a generation counter so a stale async result can never overwrite a newer one; cancel on unmount.
- Fix drag-and-drop: add `onDragOver` (with `preventDefault` and `dropEffect = "copy"`) and `onDragEnter` to the Value input and textarea. Without it the browser suppresses the drop entirely.
- Insertion rules: empty value → insert `{{ $('Node').json.path }}` and switch to Expression; inside a code block → insert the bare reference; in template text → insert a wrapped block; over a selection → replace it in its syntactic context. Use the template scanner to decide, never a brace-counting regex.
- Escape node names as string literals, use bracket notation for keys with spaces or quotes, and emit `.json[0]` (not `.json.[0]`) for a root array. Restore focus and caret after the controlled update, and clear drag classes in a `finally`.

## 7. Tests

Semantic fixtures shared by preview, HTTP and engine: single block keeps its type; mixed blocks produce a string; brace-free expression text stays text; Fixed braces stay literal; `{{ null }}` / `{{ missing }}` fail typed assignment; short-circuit skips the right operand; slices, negative indexes and quoted keys match `resolveReferences`; the BOS condition returns a native boolean across two bars with different closes (proving no result caching).

Integration: typed rows survive payload build, compiled params and recursive fallback unchanged; `$json` stays bound to the node input regardless of the selected drag panel; drag into empty / inside a block / into text / over a selection; save, load, copy-paste, import-export round trips; legacy Set/Copy/Remove unchanged for every caller; typed+persistent fails before side effects.

## Scope note

Not in this release: full JavaScript, `.item` item-linking, `$state`, `$env`, `.all()`, function calls, object/array literals, ternaries, and typed persistence.
