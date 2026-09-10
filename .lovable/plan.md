# Edit Fields — typed values + n8n-style expression evaluation

## Goal

Change Coreza's **Edit Fields** node so the middle control is no longer an operation selector (`Set Value / Copy From / Remove Field`) for new rows. Instead it becomes a **data type selector**, aligned with the type-oriented UX used elsewhere in Coreza:

- String
- Number
- Boolean
- Array
- Object

The value editor must then support **n8n-style `{{ ... }}` expressions**:

- text outside `{{ ... }}` is literal text;
- each embedded `{{ ... }}` block is evaluated independently;
- when the entire value is one `{{ ... }}` block, preserve the expression's native result type instead of converting it to text first.

The key behaviour to reproduce is:

```text
{{ $json.field2 }} > {{ $('Edit Fields1').item.json.field1 }}
```

with values 20 and 10 becomes the interpolated string:

```text
20 > 10
```

but:

```text
{{ $json.field2 > $('Edit Fields1').item.json.field1 }}
```

is evaluated as one expression and returns the Boolean:

```text
true
```

This is the main semantic change. Do **not** implement this by resolving each reference first, stripping braces, and then running the resulting string as JavaScript. That would make the two examples above behave the same and would not match n8n.

---

## Verified current Coreza implementation

The plan is based on the current `main` branch.

### Current manifest

`src/nodes/Field.json` defines the Edit Fields repeater with:

```text
left     -> field name
operator -> Set Value / Copy From / Remove Field
right    -> Value or expression
```

The default row is:

```json
{ "left": "", "operator": "set", "right": "" }
```

### Current frontend repeater

`src/components/nodes/layout/RepeaterNodeLayout.tsx` shares one renderer for If conditions and Edit Fields rows. For Edit Fields it currently looks up `left`, `operator`, and `right` and renders them through `NodeFieldRenderer`.

Reference drag/drop currently inserts values in Coreza syntax such as:

```text
{{ $('ATR').json.atr }}
```

The preview path currently delegates to `resolveReferences()`. That resolver understands reference paths but **does not evaluate JavaScript operators**, so something such as:

```text
{{ 27 > 25.4 }}
```

is not currently evaluated to `true`.

### Current backend

Edit Fields execution exists in both:

- `coreza-backend/src/nodes/executors/ControlFlowExecutor.ts`
- `coreza-backend/src/routes/comparator.ts`

The two paths currently contain Edit Fields logic separately. We should avoid adding the new expression/type semantics twice.

---

# Target UX

## New Edit Fields row

A new row should conceptually be:

```text
[ Field Name ] [ Type ] [ Value / Expression ] [ delete ]
```

Example:

```text
bullBos   Boolean   {{ last_high != null && current_bar.Close > last_high }}
```

or, using explicit Coreza references:

```text
bullBos   Boolean   {{ $('Current Bar').json.Close > $('Levels').json.last_high }}
```

The current **Set Value** dropdown is replaced by a type dropdown.

Recommended type options:

```json
[
  { "label": "String",  "value": "string" },
  { "label": "Number",  "value": "number" },
  { "label": "Boolean", "value": "boolean" },
  { "label": "Array",   "value": "array" },
  { "label": "Object",  "value": "object" }
]
```

Default type: `string`.

No separate Expression checkbox is needed for this version. The value editor is always expression-capable and `{{ ... }}` determines which parts are expressions, matching the n8n behaviour we are targeting.

## Result preview

When the value contains `{{ ... }}`, show a small **Result** preview below/adjacent to the value editor.

Examples:

```text
Input:  {{ 27 > 25.4 }}
Result: true
```

```text
Input:  {{ 27 }} > {{ 25.4 }}
Result: 27 > 25.4
```

```text
Input:  Price: {{ $json.Close }}
Result: Price: 201.45
```

The preview must use exactly the same parser/evaluator as runtime so the editor cannot say `true` while execution produces something different.

---

# Data model

Use a clean v2 row while still accepting legacy rows at runtime.

```ts
type EditFieldDataType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

interface EditFieldRowV2 {
  fieldName: string;
  dataType: EditFieldDataType;
  value: unknown;
}

interface LegacyEditFieldRow {
  left: string;
  operator: "set" | "copy" | "remove";
  right?: unknown;
}
```

A row is v2 when `dataType` is present. A row is legacy when `operator` is present.

Do not require a workflow-wide schema migration just to release this feature.

For newly-created rows use:

```json
{
  "fieldName": "",
  "dataType": "string",
  "value": ""
}
```

If keeping `left/right` internally produces significantly less frontend churn, an acceptable transitional representation is:

```json
{
  "left": "",
  "dataType": "string",
  "right": ""
}
```

but the code should expose one normalized internal shape to the evaluator/executor. Prefer a normalizer over spreading old/new key handling throughout the codebase.

---

# Core expression semantics

Implement two distinct modes based entirely on the text structure.

## 1. Whole-value expression

If, after trimming whitespace, the value consists of **exactly one** `{{ ... }}` block and nothing else:

```text
{{ expression }}
```

then evaluate the contents as an expression and return its native value.

Examples:

```text
{{ 27 > 25.4 }}        -> true          (boolean)
{{ 20 + 10 }}          -> 30            (number)
{{ $json.Close }}      -> 201.45        (number, if source is number)
{{ null }}             -> null
```

This path is what allows a Boolean Edit Fields row to output actual `true`, rather than the string `"true"`.

## 2. Interpolated template

If there is any literal text outside the expression block, or there are multiple expression blocks separated by text, evaluate each block independently and interpolate the results.

Examples:

```text
{{ 27 }} > {{ 25.4 }}
```

becomes:

```text
27 > 25.4
```

It must **not** then be evaluated a second time.

Likewise:

```text
Close={{ $json.Close }}, High={{ $json.High }}
```

becomes a normal string.

This distinction is mandatory for n8n parity.

## Expression detection

Create one shared parser for template boundaries. Avoid a simplistic greedy regex for nested/bracketed strings. At minimum it must correctly identify multiple `{{ ... }}` segments and report unclosed delimiters.

Recommended API:

```ts
type TemplatePart =
  | { kind: "text"; value: string }
  | { kind: "expression"; source: string; start: number; end: number };

function parseExpressionTemplate(input: string): TemplatePart[];

function isWholeExpression(parts: TemplatePart[]): boolean;
```

---

# Safe expression evaluator

Create a shared, dependency-light expression module, for example:

```text
src/shared/expression/
  tokenizer.ts
  parser.ts
  evaluator.ts
  template.ts
  types.ts
```

or another location importable by both frontend and backend without violating current module boundaries.

Do **not** use raw `eval`, `new Function`, `vm.runInNewContext`, or arbitrary JavaScript execution.

## Initial grammar

Support the strategy expressions Coreza actually needs:

### Literals

```text
null
true
false
123
123.45
"text"
'text'
```

### References

Support the existing Coreza reference forms so drag/drop continues to work:

```text
$json.Close
$json.bar.Close
$json.bars[0].Close

$('Node Name').json.field
$('Node Name').json.bar.Close

$node["Node Name"].json.field
$nodes["Node Name"].field
```

Also support simple identifiers from the current input object if Coreza already intentionally exposes them in expression contexts, for example:

```text
last_high
last_low
prev_bar.Close
current_bar.Close
```

If simple identifiers are enabled, resolve them only against the explicitly-provided expression scope; never fall through to JavaScript/global scope.

### Operators

Support:

```text
==  !=  ===  !==
>   >=  <    <=
&&  ||
!
+   -   *   /   %
```

and parentheses:

```text
((a + b) / 2) > threshold
```

Use standard precedence and short-circuit semantics for `&&` and `||`.

## Example BOS expression

This must work as one expression:

```text
{{
  last_high != null &&
  last_low != null &&
  prev_bar.Close <= last_high &&
  current_bar.Close > last_high
}}
```

Given valid values, runtime output for a Boolean field must be actual `true` / `false`.

## Reference resolution

Do not duplicate Coreza's node-name/id lookup rules inside a new evaluator.

Extract/factor the common logic currently used by `resolveReferences()` for:

- resolving node display name / id;
- selecting a node's JSON result;
- traversing nested paths;
- array indexes;
- missing values.

Both the existing template resolver and the new expression evaluator should call the same shared reference helper.

This is important because a dragged reference such as:

```text
$('ATR').json.atr
```

must resolve identically whether it is used alone or inside:

```text
{{ $('ATR').json.atr > 2.5 }}
```

---

# Security constraints

The expression grammar must be a whitelist.

Reject:

```text
process
require
module
exports
global
globalThis
window
document
this
new
import
function
class
=>
assignment (=, +=, -=, etc.)
++ / --
arbitrary function calls
```

Reject dangerous property access at any nesting level:

```text
__proto__
prototype
constructor
```

Use own-property access when traversing objects.

Recommended hard limits:

```text
max expression/template length : 4,000 chars
max AST nodes                  : 500
max AST depth                  : 32
max member depth               : 16
max string literal             : 1,000 chars
```

Return positional errors such as:

```text
Unexpected token "&&" at position 42
Unclosed expression starting at position 3
Property "constructor" is not allowed
```

---

# Type handling

Expression evaluation and field typing are separate phases.

Processing order:

```text
raw editor value
    -> parse template
    -> evaluate expression block(s)
    -> obtain raw result
    -> enforce selected Edit Fields type
    -> write output
```

## String

Fixed literal:

```text
hello -> "hello"
```

Whole expression:

```text
{{ $json.symbol }} -> "AAPL"
```

A whole expression returning number/boolean may be stringified for a String field.

Objects/arrays should not be silently converted to `[object Object]`; either JSON-stringify explicitly by documented rule or reject them. Prefer rejecting for v1 unless the user intentionally selected Object/Array.

## Number

Fixed value:

```text
"25.4" -> 25.4
```

Reject empty string, `NaN`, and Infinity.

Whole expression:

```text
{{ $json.Close - $json.ATR * 2 }} -> number
```

If an interpolated template results in a numeric string only, it may be parsed as Number. A value such as:

```text
20 > 10
```

must fail Number validation, not be executed again.

## Boolean

Fixed values accept only true/false semantics:

```text
true
false
"true"
"false"
```

Do not use `Boolean("false")` because that becomes `true`.

Whole expression:

```text
{{ 27 > 25.4 }} -> true
```

must remain native Boolean.

## Array

Fixed input accepts valid JSON array text:

```json
[1, 2, 3]
```

Whole expression may return an actual array.

Reject object/non-array values.

## Object

Fixed input accepts valid JSON object text:

```json
{"symbol":"AAPL","qty":10}
```

Whole expression may return an actual plain object.

Reject arrays and null.

---

# Backend implementation

## 1. Shared Edit Fields logic

Create:

```text
coreza-backend/src/nodes/logic/editFields.ts
```

Suggested API:

```ts
interface ApplyEditFieldsContext {
  input: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
  nodes: unknown[];
  persistentValues?: Record<string, unknown>;
}

function applyEditFieldRows(
  rows: unknown[],
  context: ApplyEditFieldsContext,
  options?: ApplyEditFieldsOptions,
): Record<string, unknown>;
```

Responsibilities:

- normalize legacy/new rows;
- run n8n-style template/expression evaluation for v2 rows;
- enforce `dataType`;
- assign the typed value to the requested field name;
- handle persistence consistently;
- provide one error format.

Then make both the workflow executor and manual `/comparator/field` route delegate to this module.

## 2. Do not pre-resolve expressions

This is critical.

Today the generic parameter/template resolver may see:

```text
{{ $json.Close > 100 }}
```

and try to treat `Close > 100` like a property path before Edit Fields gets it.

For the Edit Fields **value** field, preserve the original raw string through generic parameter resolution whenever it contains expression delimiters, and let the Edit Fields template/expression engine perform the single authoritative evaluation pass.

Apply the same exemption to:

- backend parameter resolution;
- compiled template path / template compiler;
- frontend preview resolution where necessary.

Do not globally disable existing reference interpolation for unrelated nodes.

## 3. Runtime error format

Examples:

```text
Edit Fields: expression failed for field "bullBos": Unexpected token ...
```

```text
Edit Fields: field "risk" expected Number but received String ("abc")
```

```text
Edit Fields: field "payload" expected Object but received Array
```

Use the same underlying error object in preview and runtime.

---

# Frontend implementation

## 1. `src/nodes/Field.json`

Replace the new-row schema with:

```json
{
  "key": "fields",
  "label": "Fields to Set",
  "type": "repeater",
  "subFields": [
    {
      "key": "fieldName",
      "type": "string",
      "placeholder": "Field name"
    },
    {
      "key": "dataType",
      "type": "select",
      "options": [
        { "label": "String", "value": "string" },
        { "label": "Number", "value": "number" },
        { "label": "Boolean", "value": "boolean" },
        { "label": "Array", "value": "array" },
        { "label": "Object", "value": "object" }
      ],
      "default": "string"
    },
    {
      "key": "value",
      "type": "text",
      "placeholder": "Value or {{ expression }}"
    }
  ],
  "default": [
    {
      "fieldName": "",
      "dataType": "string",
      "value": ""
    }
  ]
}
```

If the visual language used by the Compute node has an existing grouped/type select component, reuse that component/style rather than building a one-off dropdown.

## 2. `RepeaterNodeLayout.tsx`

Add a dedicated Edit Fields row branch instead of forcing the new schema through the condition-row assumptions (`left/operator/right`).

Recommended rendering:

```text
Field name
Type dropdown
Value editor
Result preview
Delete button
```

or keep the compact horizontal layout if it remains readable.

Do not affect If/Switch repeaters.

## 3. Value editor behaviour

The value editor should:

- accept plain fixed values;
- accept one or more `{{ ... }}` blocks;
- use monospace styling while expression syntax is present;
- allow multiline expressions;
- preserve newline/spacing inside the expression;
- show parser errors without requiring Execute.

## 4. Drag/drop

Keep the current Coreza reference syntax:

```text
{{ $('Node Name').json.path }}
```

When dropping into an empty value field, insert the complete wrapped reference.

When dropping **inside an existing whole expression**, avoid nested braces.

Example existing value:

```text
{{ current_bar.Close > 100 }}
```

Dropping `last_high` at the caret should insert the bare reference expression:

```text
$('Levels').json.last_high
```

not:

```text
{{ $('Levels').json.last_high }}
```

inside the existing braces.

Implement cursor-aware insertion using `selectionStart` / `selectionEnd`; do not always append at the end. This also addresses the drag/drop usability issue previously seen in Edit Fields.

## 5. Preview

Add a debounced preview, approximately 150–300 ms.

Preview rules:

```text
no {{ }} present       -> optionally preview typed fixed value
whole expression       -> render native evaluated result
mixed interpolation    -> render interpolated text
parse/type error        -> render error
missing upstream data  -> show "Execute previous nodes to preview"
```

Use the same shared expression/template package as runtime.

---

# Legacy compatibility

The UI for newly-created rows should not show `Set Value / Copy From / Remove Field`.

However, existing saved workflows may contain those operations. Do not break execution.

Runtime should continue to recognize:

```json
{ "left": "x", "operator": "set", "right": "10" }
{ "left": "x", "operator": "copy", "right": "y" }
{ "left": "x", "operator": "remove" }
```

Move their current behaviour into the shared Edit Fields logic without changing semantics during this feature.

For the editor, choose one explicit compatibility strategy and test it:

**Preferred:** when a workflow contains legacy rows, render a small "Legacy field rule" representation for those rows so users can still view/remove them, but all new rows use the typed model.

Do not silently reinterpret `copy` or `remove` as String fields.

A later migration can replace those operations with dedicated nodes/features if desired.

---

# Persistence

The top-level `Persistent` toggle remains.

For v2 typed fields, persistence should store the **final typed result**, not the raw expression text.

Example:

```text
Boolean + {{ close > last_high }}
```

stores:

```ts
true
```

not:

```text
"{{ close > last_high }}"
```

Define write-through behaviour consistently for manual execution, normal workflow execution, live execution, and backtest execution.

Do not use this feature to silently change legacy persistence semantics unless covered by a separate explicit fix.

---

# Tests

## Expression/template unit tests

Create tests covering at least:

```text
{{ 27 > 25.4 }}                         -> true
{{ 27 }} > {{ 25.4 }}                   -> "27 > 25.4"
Price={{ 27 }}                           -> "Price=27"
{{ 1 + 2 * 3 }}                          -> 7
{{ (1 + 2) * 3 }}                        -> 9
{{ true && false || true }}              -> true
{{ null != null }}                       -> false
```

Reference tests:

```text
{{ $json.Close > 100 }}
{{ $('Node A').json.Close > 100 }}
{{ $json.bars[0].Close }}
```

BOS test:

```text
{{
  last_high != null &&
  last_low != null &&
  prev_bar.Close <= last_high &&
  current_bar.Close > last_high
}}
```

Assert true and false cases.

## n8n semantic parity tests

These are mandatory regression tests:

```text
{{ 20 }} > {{ 10 }}
```

must produce:

```text
"20 > 10"
```

while:

```text
{{ 20 > 10 }}
```

must produce:

```ts
true
```

There must be no second evaluation pass for the interpolated result.

## Type tests

String:

```text
abc -> "abc"
{{ 10 }} -> "10" when field type is String
```

Number:

```text
"10" -> 10
{{ 5 + 5 }} -> 10
"" -> error
"abc" -> error
```

Boolean:

```text
true -> true
false -> false
"false" -> false
{{ 10 > 5 }} -> true
```

Array/Object:

- valid JSON fixed values;
- actual typed expression outputs;
- mismatched result types rejected.

## Security tests

Ensure all of these fail safely:

```text
{{ process.env }}
{{ require('fs') }}
{{ globalThis }}
{{ this }}
{{ new Date() }}
{{ (() => 1)() }}
{{ obj.constructor }}
{{ obj.__proto__ }}
{{ arr.push(1) }}
{{ x = 1 }}
{{ import('fs') }}
```

Also test size/depth limits and prototype-polluted objects.

## Integration parity

Run the same Edit Fields node through:

- direct/manual comparator route;
- `ControlFlowExecutor`;
- normal workflow engine;
- backtest execution path where applicable.

Assert identical value and JavaScript type.

Example Boolean result must satisfy:

```ts
result.bullBos === true
typeof result.bullBos === "boolean"
```

not only string comparison against `"true"`.

## Frontend tests

Verify:

- Set Value is gone for new rows;
- String/Number/Boolean/Array/Object selector is visible;
- new row defaults to String;
- whole expression preview shows native result;
- mixed expressions preview as interpolation;
- parser errors are shown;
- drag/drop inserts at caret;
- drag/drop inside an existing `{{ ... }}` does not create nested braces;
- If and Switch repeater UI is unchanged.

---

# Suggested implementation order

1. Add expression template parser and tests for whole-expression vs interpolation semantics.
2. Add safe expression tokenizer/parser/evaluator and reference resolution.
3. Add type coercion/validation utilities.
4. Extract shared Edit Fields execution logic and keep legacy behaviour intact.
5. Add resolver bypass so Edit Fields expressions reach the evaluator raw.
6. Change `Field.json` from operation selector to type selector for new rows.
7. Add dedicated Edit Fields frontend rendering and typed editors.
8. Add live Result preview using the same evaluator.
9. Fix cursor-aware drag/drop and nested-brace handling.
10. Add executor/route/backtest parity tests.
11. Run node manifest validation, frontend tests, backend tests, typecheck, and production build.

---

# Acceptance criteria

The work is complete only when all of the following are true:

- Edit Fields no longer shows **Set Value** for a newly-created field row.
- The middle control shows **String / Number / Boolean / Array / Object**.
- Plain values still work.
- Existing dragged `{{ reference }}` values still work.
- `{{ 27 > 25.4 }}` previews and executes as native Boolean `true`.
- `{{ 27 }} > {{ 25.4 }}` previews as the literal/interpolated string `27 > 25.4` and is **not evaluated again**.
- Complex BOS conditions inside one `{{ ... }}` block work.
- Preview and runtime use the same evaluator and produce the same value/type/error.
- No raw `eval`/`Function`/VM execution is introduced.
- Existing saved legacy `set/copy/remove` workflows continue to execute.
- If/Switch repeaters are unaffected.
- Manual, workflow, live/backtest paths produce the same typed output.

## Explicit non-goals for this change

Defer these unless they are required by an existing Coreza workflow:

- arbitrary JavaScript function calls;
- ternary operator;
- optional chaining;
- object/array literal expressions beyond fixed JSON input;
- async expressions;
- `$state` mutation from expressions;
- auto-migrating legacy `copy/remove` rows;
- executing interpolated output as a second expression pass.
