# Compute node: extreme-by-value extraction (key or value)

Instead of adding separate `maxValueKey` / `minValueKey` operators, add **one** object operation that covers max/min and can return the key, the value, or both. This keeps the operator list short and matches the existing `map` pattern (an operator plus a sub-operation select).

## New operation

`extremeByValue` — label **"Extract by Value (Max/Min)"**, in the `object` group of `groupedOptions`.

Two supporting select fields, both shown only when `operator = extremeByValue`:

| Field | Label | Options | Default |
|---|---|---|---|
| `extremeDirection` | Direction | Max / Min | `max` |
| `extremeReturn` | Return | Key / Value / Entry (`{ key, value }`) | `key` |

This mirrors how `map` uses `mapSubOperation` / `mapIndex`, so no new UI machinery is needed — `displayOptions.show.operator` already drives visibility.

## Behaviour

- Input goes through the existing `validateObject`, so plain objects and JSON strings are both accepted (same as `keys` / `values`).
- Empty object -> error `Object cannot be empty`.
- Entries whose value is not finite-numeric are skipped; if none remain -> error `Object does not contain numeric values`.
- Ties resolve to the first matching key in insertion order (strict `>` for max, `<` for min).
- Return shape follows `extremeReturn`:
  - `key` -> `"MSFT"`
  - `value` -> `0.91` (the numeric value)
  - `entry` -> `{ "key": "MSFT", "value": 0.91 }`

## Changes

### `coreza-backend/src/nodes/logic/compute.ts`
Add a `case "extremeByValue"` in the object-operations block (after `objectIsEmpty`, ~line 1299). It reads the two new args from the operation payload, validates the object, computes the extreme entry with a single filter+reduce, and returns via `createSuccessOutput` / `createErrorOutput` like the surrounding cases. Unknown/blank `extremeDirection` defaults to `max`, unknown/blank `extremeReturn` defaults to `key`.

### `src/nodes/Compute.json`
- Add `{ "label": "Extract by Value (Max/Min)", "value": "extremeByValue" }` to the `object` group options.
- Add the `extremeDirection` and `extremeReturn` select fields with `displayOptions.show.operator: ["extremeByValue"]`.

### `coreza-backend/src/routes/comparator.ts`
Forward `extremeDirection` and `extremeReturn` from the request body into the compute call, the same way `mapSubOperation` / `mapIndex` / `regexFlags` are forwarded.

The existing `pick` ("Extract") operation is left untouched — it stays the key-list extractor.

## Example

Value `{{ $('Momentum Scores').json.data }}` = `{ "AAPL": 0.82, "MSFT": 0.91, "TSLA": 0.45 }`

- Direction `Max`, Return `Key` -> `"MSFT"`
- Direction `Max`, Return `Value` -> `0.91`
- Direction `Min`, Return `Entry` -> `{ "key": "TSLA", "value": 0.45 }`
