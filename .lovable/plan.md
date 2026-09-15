# Compute: dynamic nth root — reviewed implementation plan

## Review of the attached plan

Verified against the current code, and the attached plan's findings hold:

- `coreza-backend/src/nodes/logic/compute.ts` has no `sqrt`, `cbrt`, `root` or `pow` case. Its Number group is Round, Floor, Ceil, Abs, Add, Subtract, Multiply, Divide, Modulo. `Math.sqrt` appears only inside the array standard-deviation operation.
- `src/nodes/Compute.json` lists the same Number options, and `arg1` already uses `displayOptions.show.operator` plus `dynamicLabel.labelsByValue` — exactly the two places a new operation plugs into (as `getIndex` recently did).
- `ComputeInput` already carries `value`, `operator`, `arg1`, so no shape change is needed.

So the design — one `root` operation using the existing `arg1` as the degree — is the right shape. Adopt it with these corrections.

### Corrections and improvements

1. **Return errors, do not throw.** The attached sample `calculateRoot` throws for even roots of negatives. Every case in `compute.ts` returns `createErrorOutput(...)`; keep that and have the helper return a discriminated result instead of throwing, so the even-root domain error is not caught by the generic catch and reworded.
2. **Keep strict validation local, and say so in code.** Existing Number operators use loose `Number(value)`, where `null`, `false` and `[]` become `0`. The new strict parser must be a separate helper used only by `root`, with a comment, so nobody "harmonises" the others later by accident.
3. **Degree 1 and zero must be exact.** `Math.pow(x, 1/1)` is not guaranteed to round-trip exactly for all inputs; short-circuit `n === 1` to return `x` and `x === 0` to return `0` before any exponentiation, and normalise `-0` to `0`.
4. **Placeholder, not default.** Agreed with the attached plan: never give shared `arg1` a default of `2`, since it is shared with add, divide, slice, getIndex, string and object operations. Use the dynamic label to carry the hint.
5. **No `power` operation in this change.** Fractional and negative exponents are a separate feature; mention it as a follow-up so `root` does not quietly grow into it.
6. **Test-file naming follows the existing focused style** already in the repo: `coreza-backend/tests/computeGetIndex.test.ts`, `computeExtremeByValue.test.ts` — so `computeRoot.test.ts` fits.

## Feature

One Number operation, **Root (Nth Root)**, operator id `root`.

| UI field | Stored field | Meaning |
| --- | --- | --- |
| Value | `value` | The number to take the root of |
| Operation | `operator: "root"` | Selects the operation |
| Root Degree (2 = square, 3 = cube) | `arg1` | Positive safe-integer degree, literal or resolved reference |

Semantics: for `x >= 0` the result is `x^(1/n)`. For `x < 0` with odd `n` the result is `-(|x|^(1/n))`. For `x < 0` with even `n` it is a domain error. Only the principal real root is returned.

| Value | Degree | Result |
| ---: | ---: | ---: |
| 81 | 2 | 9 |
| 27 | 3 | 3 |
| 81 | 4 | 3 |
| 32 | 5 | 2 |
| 1024 | 10 | 2 |
| -27 | 3 | -3 |
| -32 | 5 | -2 |
| 0.008 | 3 | ≈0.2 |
| 49 | 1 | 49 |
| 0 | 7 | 0 |

Request and output reuse the existing contract; `data` stays a bare number:

```json
{ "value": 81, "operator": "root", "arg1": 4 }
{ "success": true, "status": "success", "data": 3 }
```

## Backend — `coreza-backend/src/nodes/logic/compute.ts`

Add a local strict parser plus a `root` case beside the other Number operations:

1. `parseStrictFiniteNumber(input)` — accepts finite primitive numbers and non-empty trimmed numeric strings, including scientific notation. Rejects `null`, `undefined`, empty/whitespace strings, booleans, arrays, objects, BigInt, `NaN`, `Infinity`, and unresolved `{{ ... }}` strings. Type-check before calling `Number`.
2. Degree validation: `Number.isSafeInteger(n) && n >= 1`.
3. Domain check: negative value with even degree returns an error before calculating.
4. Calculation, returning a result rather than throwing:

```ts
// strict on purpose: other Number ops keep their historical loose coercion
function calculateRoot(x: number, n: number): number {
  if (x === 0) return 0;          // also normalises -0
  if (n === 1) return x;
  if (n === 2) return Math.sqrt(x);
  if (n === 3) return Math.cbrt(x);
  const magnitude = Math.pow(Math.abs(x), 1 / n);
  return x < 0 ? -magnitude : magnitude;
}
```

5. Reject a non-finite result, normalise `-0` to `0`, and return via `createSuccessOutput` / `createErrorOutput` like every other case. Keep full precision; users chain the existing Round operation if they want fewer decimals.

| Condition | Message |
| --- | --- |
| Invalid value | `Value must be a finite number` |
| Missing degree | `Root degree is required; use 2 for square root` |
| Invalid degree | `Root degree must be a positive safe integer` |
| Negative value, even degree | `Even roots of negative values have no real result` |
| Non-finite result | `Root result is not a finite number` |

No change is expected in `routes/comparator.ts` or `ControlFlowExecutor.ts`: the executor already resolves parameters via `context.resolveNodeParameters` before calling `ComputeService.compute`, and the route forwards `value`/`operator`/`arg1`. Both are verified, not edited.

## Frontend — `src/nodes/Compute.json`

1. Add `{ "label": "Root (Nth Root)", "value": "root" }` to `operator.groupedOptions.number.options`.
2. Add `"root"` to `arg1.displayOptions.show.operator`.
3. Add `"root": "Root Degree (2 = square, 3 = cube)"` to `arg1.dynamicLabel.labelsByValue`.
4. Extend the node help to describe the degree, the negative-odd behaviour and the even-negative error.

No new node, field type, output handle or dropdown of degrees. The existing text input keeps reference drag/drop working.

## Dynamic inputs

Both operands must work as references:

```text
Value:       {{ $json.amount }}
Root Degree: {{ $json.degree }}
```

`{ amount: 81, degree: 4 }` gives 3; the next run with `{ amount: 32, degree: 5 }` gives 2 with no config change. The service never evaluates expressions itself — it only sees resolved numbers or numeric strings.

## Tests — `coreza-backend/tests/computeRoot.test.ts`

| Area | Cases |
| --- | --- |
| Ordinary roots | Square, cube, fourth, fifth, tenth from the table above |
| Negative values | Odd degree gives a negative result; even degree errors |
| Boundaries | `0`, `-0` normalised, degree 1 exact, value 1, largest safe-integer degree |
| Decimal and string inputs | `0.008`, `"81"`, `" 4 "`, `"1e-12"` |
| Invalid value | Missing, null, empty, whitespace, boolean, array, object, NaN, Infinity, unresolved `{{ }}` |
| Invalid degree | Missing, null, zero, negative, fractional, non-finite, unsafe integer |
| Scale | Very small positives and values near `Number.MAX_VALUE` stay finite |
| Contract | `data` is a number; no NaN/Infinity serialised as a successful value |
| Dynamic execution | Value and degree both change between runs; no stale argument |
| Regression | Existing Number operations and array standard deviation unchanged |

Use relative tolerance (about `1e-12`) for general roots and scale-appropriate tolerance for tiny values so a wrongly returned `0` cannot pass. Assert exact equality only where the contract guarantees it — degree 1 and zero.

Add integration assertions to the existing Compute route and executor suites where their harnesses allow, plus a UI check that Root appears under Number with the right label and that a dropped reference survives save and reopen.

## Delivery

1. Backend operator, strict parser and focused tests.
2. The three `Compute.json` changes and help text.
3. Verify through workflow execution, single-node execution and the HTTP route.
4. Run the focused Compute suites and the repository type/build checks, reading full output.

Ship backend before or with the frontend option, so the dropdown never offers an unsupported operation. No migration is needed — `root` is additive and keeps the existing scalar output.

**Follow-up, not in this change:** a separate `power` operation for fractional and negative exponents.

## Backend repository note

`compute.ts` and its tests live in the separated `coreza-io/coreza-backend` repository and must be copied across manually, as usual.

## Done when

A single Compute node computes any supported nth root from runtime-provided value and degree, negative odd roots work, invalid domains give clear messages, output stays a plain number, and every existing operation behaves exactly as before.
