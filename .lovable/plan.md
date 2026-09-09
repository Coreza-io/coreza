# Edit Fields v2 — typed values and safe expressions

The document's direction is right: typed rows (`fieldName` + `dataType` + `valueMode` + `value`) with a small, non-`eval` expression grammar, and untouched legacy rows. Below is the plan adjusted to how Coreza actually works today — three parts of the doc do not survive contact with the code and are corrected.

## Verified against the code

- `src/nodes/Field.json:19-56` — repeater `fields` with subFields `left` / `operator` (`set` | `copy` | `remove`) / `right`.
- `coreza-backend/src/nodes/executors/ControlFlowExecutor.ts:165-263` — `executeFieldNode`, the engine path. Starts from `result = {}`.
- `coreza-backend/src/routes/comparator.ts:162-243` — `POST /comparator/field`, the manual/HTTP path. Starts from `result = { ...data }`.
- `src/components/nodes/layout/RepeaterNodeLayout.tsx:72-144` — one shared repeater layout for `conditions`, `fields`, and `cases`, already branching on `isFieldRepeater`.
- `src/utils/resolveReferences.ts` — the existing template resolver: path lookups, negative indexes, slices. No operators, no arithmetic.

## Three corrections to the document

**1. One resolution pass, done by the evaluator (the n8n model).**
n8n does not pre-resolve an expression and then evaluate the leftovers — the whole `{{ ... }}` goes into its expression engine, which resolves `$json`, `$('Node').json.x`, and the operators around them in a single pass, and renders the outcome in the Result panel. Coreza must do the same, because today's `resolveReferences` would eat the expression first: `{{ $json.Close > 100 }}` matches the template regex, which reads `Close > 100` as a property path and returns `undefined`, so the evaluator would never see the source text. So:

- Expression rows bypass template pre-resolution and reach the executor as raw text. Implement it in `ParameterResolver.resolveDeep`'s handling of the `fields` array (`coreza-backend/src/engine/parameterResolver.ts:78-98`, plus the compiled path in `templateCompiler` and the matching frontend resolver): a row with `valueMode === "expression"` keeps `value` verbatim. Fixed rows keep today's behaviour, so `{{ $json.x }}` in a fixed row still works exactly as now.
- The evaluator then does the resolution itself, from the same context: `$json` = resolved node input, `$nodes` = `getAllNodeResults()`, `$state` = this node's persistent values.
- **The grammar therefore has to accept Coreza's existing reference syntax**, not just the doc's `$json.a`: `$('Node Name').json.path` and `$node["Node Name"].json.path` resolve through the same node-name/label/id lookup and `pickJsonSource` precedence that `resolveReferences` uses (`resolveReferences.ts:63-110`). Otherwise every dragged reference breaks the moment a user adds an operator to it. Factor that lookup into a shared helper so the two resolvers cannot drift.


**2. Parity requires a shared module, because the two paths already disagree.**
The route seeds `result` with the incoming `data`; the executor seeds it with `{}`. The route's `set` writes the new value; the executor's `set` prefers an already-persisted value over the new one (so a persistent `set` effectively never updates after the first run). These are pre-existing bugs and I am not silently changing v1 behaviour — but v2 cannot be written twice. Extract `coreza-backend/src/nodes/logic/editFields.ts` exporting `applyFieldRows(rows, input, ctx)`, have both call sites delegate, and keep a `legacyResultSeed` option so each path preserves its current seeding for v1 rows. v2 rows get one defined behaviour in both paths. Flag the persistent-`set` divergence in the PR description as a follow-up decision for the user rather than fixing it here.

**3. Drop `binary` and `$state` from v1.**
- A `Binary Data` dropdown option with no editor and no runtime meaning is a dead end that will be reported as a bug. Leave it out until binary handling exists.
- There is no `$state` object in `NodeExecutionContext` matching the doc's description. What exists is `getState`/`setState` (per-execution scratch) and `getPersistentValue`/`setPersistentValue` (Edit Fields persistence). Expose `$state` in v1 as a **read-only snapshot of this node's persistent values only** — that is what strategy rows like `$json.Close > $state.last_high` actually need — and document it as such. No writes from expressions.

Otherwise the doc's security posture is correct and adopted verbatim: no `eval`, no `Function`, no `vm`; parse to an AST and evaluate only whitelisted node types; reject `__proto__`, `prototype`, `constructor`; no function calls, assignment, or `new`.

## Data model

```ts
type EditFieldDataType = "string" | "number" | "boolean" | "array" | "object";
type EditFieldValueMode = "fixed" | "expression";

interface EditFieldRowV2 {
  fieldName: string;
  dataType: EditFieldDataType;
  valueMode: EditFieldValueMode;
  value: unknown;          // fixed literal, or raw expression text
}
```

No `schemaVersion` field and no row `id`: a row is v2 when `dataType` is present, v1 when `operator` is present. That keeps saved workflows byte-compatible and avoids a migration.

## Changes

### 1. `coreza-backend/src/nodes/logic/safeExpression.ts` (new)

Hand-written tokenizer + Pratt parser + evaluator. No new dependency — pulling in a JS parser and then blacklisting most of the language is a larger attack surface than a ~300-line grammar.

- **Tokens:** numbers, single/double-quoted strings, identifiers, the roots `$json` / `$nodes` / `$state` / `$(` / `$node[`, `.`, `[`, `]`, `(`, `)`, operators `== != === !== > >= < <= && || ! + - * / %`.
- **Grammar:** literals (`null`, `true`, `false`, number, string), the reference roots below, member access (dot, plus bracket access with a string or integer literal so `$nodes['ATR']` and `$json.bars[0]` work — worth it because Coreza data is array-heavy), unary `!` and `-`, the binary operators above with standard precedence, and parentheses.
- **Reference roots (n8n-compatible, matching Coreza's existing syntax):** `$json...`, `$('Node Name').json...`, `$node["Node Name"].json...`, `$nodes...`, `$state...`. `$(` and `$node[` are parsed as dedicated root forms taking a single string literal — this is the *only* place a `(` may follow a token, and it is not a call node. Node lookup and `pickJsonSource` precedence come from the helper shared with `resolveReferences`.
- **Rejected at parse time:** any other `(` following an expression (call), `new`, `=`, `++`, `=>`, template literals, and the identifiers `process`, `require`, `globalThis`, `this`, `import`.
- **Rejected at member-access time:** `__proto__`, `prototype`, `constructor`, and any key inherited rather than own (`Object.prototype.hasOwnProperty.call`).
- **Limits:** max input length 4000 chars, max AST depth 32, max node count 500, max member-access depth 12, max string literal 1000 chars. Each violation is a named parse error.
- **Semantics:** `==`/`!=` compile to strict `===`/`!==` (no reason to inherit JS coercion here); `&&`/`||` short-circuit; missing paths yield `undefined`, not a throw; arithmetic on non-numbers yields a typed error rather than `NaN` propagation.
- **Errors:** `ExpressionError` carrying message + character position, so the caller can render `Unexpected token "&&" at position 42`.
- Entry point: `evaluateExpression(text, { $json, $nodes, $state, nodes })`, where `text` may be bare (`$json.a > 1`) or wrapped in a single `{{ ... }}`, which is stripped first. A bare reference with no operators — the plain dragged `{{ $('ATR').json.atr }}` — is a valid expression and returns the raw typed value, so a fixed-mode row and an expression-mode row containing the same reference agree.


### 2. `coreza-backend/src/nodes/logic/editFields.ts` (new)

- `coerceFixedValue(value, dataType)` — string passes through; number via `Number()` with a finite check; **boolean only from literal `true`/`false`/`"true"`/`"false"`** (never `Boolean(x)`); array/object via `JSON.parse` plus `Array.isArray` / plain-object checks.
- `checkExpressionResult(value, dataType, fieldName)` — strict: a Number field must receive a finite number, Boolean a real boolean, Array an array, Object a plain non-null object. No silent coercion of `undefined`/`null` into `false`/`0`. String is the one relaxed case: numbers and booleans are stringified, objects are rejected.
- `applyFieldRows(rows, { input, seed, context })` — iterates rows, dispatching v1 rows to the existing legacy switch (moved verbatim) and v2 rows to fixed/expression handling, honouring `persistent` for v2 with write-through semantics (evaluate, store, return).
- Errors are returned as `leanError`-shaped failures with the doc's wording: `Edit Fields: expression failed for field "bull_bos": ...` and `Edit Fields: field "risk" expected Number, but expression returned String ("abc")`.

### 3. `ControlFlowExecutor.ts` and `routes/comparator.ts`

Both replace their inline loops with `applyFieldRows`, passing their own seed (`{}` for the executor, `{ ...data }` for the route) so v1 behaviour is bit-identical. The executor keeps its existing sync/persistent guard (`isPromiseLike` → "requires async execution").

### 4. Template-resolution exemption

In the resolver used by `resolveNodeParameters` for node values, add an Edit Fields carve-out: when resolving the `fields` array, rows with `valueMode === "expression"` keep `value` unresolved. Add a unit test asserting a raw expression survives resolution untouched, in both the frontend (`src/utils/resolveReferences.ts` callers) and backend resolvers, since the two are kept in parity by `tests/utils/resolveReferences-parity.test.ts`.

### 5. `src/nodes/Field.json`

Replace the `fields` repeater subFields with `fieldName` (string), `dataType` (select: String/Number/Boolean/Array/Object), `valueMode` (select: Fixed/Expression), `value` (text). Default row: `{ "fieldName": "", "dataType": "string", "valueMode": "fixed", "value": "" }`. `persistent` stays top-level. Legacy rows are not described in the schema — they are simply still accepted at runtime. Re-run `npx tsx scripts/validate-nodes.ts`.

### 6. `src/components/nodes/layout/RepeaterNodeLayout.tsx`

Under the existing `isFieldRepeater` branch, render the row vertically: Field Name, Type, a Fixed/Expression segmented control, then the value editor. The value editor switches on type — plain input for string/number, a true/false select for boolean, a textarea for array/object JSON with inline parse feedback — and switches to a monospace multi-line textarea in Expression mode. Condition (`conditions`) and switch (`cases`) rendering is untouched.

Drag-and-drop reference insertion becomes cursor-aware: capture `selectionStart`/`selectionEnd` on the focused editor and splice the dragged reference in at that offset instead of appending. In an expression editor insert the bare reference (`$('ATR').json.atr`), not a nested `{{ ... }}` — the doc's nested-brace example is not valid input; the row's single outer `{{ }}` wraps the whole expression, exactly like n8n.

**Result preview panel** (the screenshot): under an expression row, show a debounced live `Result` block rendering the evaluated value, `[empty]` when the input is blank, and the positional parse/type error when it fails — plus the "Execute previous nodes to use input data" hint when no upstream output is cached. Drive it from the same evaluator: build `safeExpression.ts` as a dependency-free module importable by both the backend and the browser bundle, and feed it the cached upstream node outputs the panel already has. Sharing one module is what guarantees the preview and the run agree; do not reimplement the grammar for the frontend.


## Tests

**`coreza-backend/tests/safeExpression.test.ts`**
- Literals, comparison, arithmetic precedence, grouping, short-circuit `&&`/`||`, unary `!` and `-`.
- Reference resolution from `$json`, `$nodes`, `$state`; missing path → `undefined`; array index access.
- The doc's BOS example returns `true` with its stated inputs, and `false` when `last_high` is null.
- Security, each rejected at **parse** time with a positional error: `process.env`, `require("fs")`, `globalThis`, `foo()`, `obj.__proto__`, `obj.constructor`, `obj.prototype`, `new Something()`, `x = 1`, `arr.push(1)`, `import("fs")`, `(() => 1)()`, `this`.
- Every limit (length, depth, node count, member depth, string length) trips its own named error.
- A prototype-polluted input object cannot leak inherited keys.

**`coreza-backend/tests/editFieldsV2.test.ts`**
- Fixed coercion per type, including `"false"` → `false` (not `true`) and `""`/`"abc"` rejected for Number.
- Expression type mismatches produce the exact documented error strings.
- `undefined`/`null` results are never coerced to `false`/`0`.
- Persistent v2 rows write through and read back.
- **Parity:** the same rows and input through `ControlFlowExecutor.executeFieldNode` and `POST /comparator/field` yield the same values, types, and error text.
- **Compatibility:** legacy `set`, `copy`, `remove`, and a node mixing v1 and v2 rows all behave exactly as before (snapshot the current outputs first, then assert against them).

**Frontend** — new row defaults to String + Fixed; the type dropdown holds the five types; toggling Value Mode swaps editors; drag-drop inserts at the caret, not the end.

## Deferred

Binary data, `$state` writes, ternary, optional chaining, object/array literals, function calls and helpers, automatic migration of legacy Copy/Remove rows. Legacy rows keep working indefinitely; no auto-rewrite on save.

## Verification

`tsgo` typecheck, `npx tsx scripts/validate-nodes.ts`, backend jest (new suites plus `tests/workflow/*`), frontend jest. Manual: build a node with a boolean BOS expression and a numeric `close - atr * 2` expression, run it manually and inside a backtest, and confirm identical typed output.
