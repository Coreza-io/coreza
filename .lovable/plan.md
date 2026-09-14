# Array literals in Edit Fields expressions

## Review of the suggestion

The suggestion is correct in approach and in its file targeting. Verified against the current code:

- The tokenizer rejects `,` outright (`safeExpression.ts` punctuation set is `".[]():"`), which is exactly the reported failure.
- Bracket handling for `items[0]`, `items[-1]`, `items[1:3]` lives in `members()`, which only runs after an operand, so adding a prefix-position `[` cannot disturb it.
- The template layer already returns the raw value for a single complete `{{ ... }}` and stringifies mixed text via `JSON.stringify`, so no change is needed there.
- The template scanner already balances `[`/`]` and tolerates newlines, so the multi-line example compiles once the parser accepts it.
- The typed Edit Fields layer already accepts `array` and validates with `Array.isArray`, both for Expression mode and for Fixed mode via `JSON.parse`.
- The frontend preview imports the same evaluator, so it gains array support with no separate frontend work.

### Improvements on top of the suggestion

1. Add an explicit element-count cap for one literal in addition to the global AST-node cap, so a single huge literal fails with a clear message.
2. Give slice-like input in prefix position (`{{ [1:3] }}`) a deliberate, readable error instead of a generic token error.
3. Parse elements at the assignment-free precedence used elsewhere and treat `,` strictly as a separator, so `[1,]`, `[,1]`, `[1,,2]` fail at the offending comma with accurate positions.
4. Keep `this.members()` running after an array literal so `{{ [3,1,2][0] }}` and `{{ [[1,2],[3,4]][1][0] }}` behave predictably rather than being an accidental parse error.
5. Confirm empty `{{ [] }}` returns a real empty array and passes Array validation, rather than being treated as no value.
6. Add the round-trip case where an array result feeds a downstream Compute node, since that is the actual reported goal.

## Implementation

All production changes are in `coreza-backend/src/nodes/logic/safeExpression.ts`.

1. **Tokenizer**: add `,` to the punctuation character set. No other token changes.
2. **AST**: add `{ kind: "array"; elements: Ast[]; position: number }` to the union, so each element keeps its own expression tree.
3. **Prefix parsing**: when `prefix()` sees `[` as the start of an operand, parse an array literal, then continue through the existing `members()` chain.
4. **Array literal parser**:
   - consume `[`; return an empty array node immediately on `]`.
   - otherwise parse one element expression, then require either `]` or `,`; a `,` immediately followed by `]` is an error (no trailing commas).
   - a leading `,` and a doubled `,` are errors reported at that comma.
   - a `:` where `,` or `]` is expected raises a dedicated message stating that slices are only valid on an existing array value.
   - enforce a per-literal element cap and build the node through `make()` with `depth + 1` for elements so existing depth and node limits still apply.
5. **Evaluation**: evaluate an array node by evaluating each element in order and returning a real array.
6. **Node-reference collection**: visit array elements when gathering `nodeReferences`, so expressions inside a literal still register their upstream node dependencies.

No changes to `editTemplate.ts`, `editFields.ts`, `ControlFlowExecutor.ts`, or any node JSON. Object literals stay out of scope.

## Tests

**Expression parser** (`coreza-backend/tests/safeExpression.test.ts`)
- `[]`, `[1]`, `[1,2,3]`, `[1 + 2, 3 * 4]`, `[true, false, null]`, `['a', "b"]`.
- Node references: `[$("A").json.value, $("B").json.value]`.
- Nesting and indexing: `[[1,2],[3,4]][1][0]`, `[3,1,2][0]`.
- Rejections with clear errors: `[1,]`, `[,1]`, `[1,,2]`, `[1`, `[1:3]`.
- Limits: deeply nested literals and an oversized literal must still hit depth/node/element caps rather than bypass them.
- Existing rejections stay intact, including `someFunction()` and blocked identifiers/members.

**Template layer** (`coreza-backend/tests/editTemplate.test.ts`)
- `{{ [1,2] }}` returns a real array.
- `values={{ [1,2] }}` returns the string `values=[1,2]`.
- The multi-line literal from the report compiles and evaluates.

**Edit Fields** (`coreza-backend/tests/editFieldsV2.test.ts`)
- Type Array + Expression `{{ [1,2] }}` produces `[1,2]` and passes validation.
- The reported expression against mocked `getimpulseHigh` and `bars` inputs produces `[26,26]`.
- Type String + Expression `{{ [1,2] }}` still fails type validation.
- Type Array + Fixed `[1,2]` still parses as before.

**Regression**
- `1 + 2`, `a > b`, `a && b`, `$json.value`, `$("Node").json.data.value`, `$json.items[0]`, `$json.items[-1]`, `$json.items[1:3]`, `$json.items[-2:].close` unchanged.

## Verification

- Run the backend Jest suites for the expression engine, template, Edit Fields and the Edit Fields route, plus the frontend Vitest suites, and read full output.
- Manually confirm in the editor that the Array + Expression row previews `[26,26] · Array`, executes successfully, and that a downstream Compute Max consumes it without a workaround.

## Done when

The reported multi-line array expression previews and executes as a genuine array, mixed-text templates still produce strings, indexing and slicing are unchanged, malformed literals fail with precise messages, and all parser security limits still hold.
