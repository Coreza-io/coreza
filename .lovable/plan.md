# Compute node: key-by-value operations

Add object operators that return the *key* holding the extreme numeric value, instead of the value itself.

## Operators

- `maxValueKey` — "Get Key of Max Value"
- `minValueKey` — "Get Key of Min Value" (same logic, inverted comparison — added for symmetry since one without the other is awkward in a strategy graph)

Behaviour for both:
- Input must be an object (uses the existing `validateObject`, so JSON strings are accepted the same way `keys`/`values` accept them).
- Empty object -> error `Object cannot be empty`.
- Non-numeric entries are skipped; if none remain -> error `Object does not contain numeric values`.
- Ties resolve to the first matching key in insertion order (strict `>` / `<` in the reduce).
- Returns the key as a string.

## Changes

### `coreza-backend/src/nodes/logic/compute.ts`
In the object-operations block (after `objectIsEmpty`, ~line 1299), add both cases. Shared logic goes in a small private helper to avoid duplicating the filter/reduce:

```
private static extremeValueKey(value, direction: "max" | "min")
  -> { ok: true, key } | { ok: false, error }
```

Each case calls the helper and returns `createSuccessOutput(key)` or `createErrorOutput(error)`, matching the shape of the surrounding cases.

### `src/nodes/Compute.json`
Add two options to the `object` group in `groupedOptions`, after `Is Empty`:
- `{ "label": "Get Key of Max Value", "value": "maxValueKey" }`
- `{ "label": "Get Key of Min Value", "value": "minValueKey" }`

No new fields — both operators use only `value`, so no `displayOptions` or route plumbing changes are needed (`/comparator/compute` already forwards `value` and `operator`).

## Example

Input `{ "AAPL": 0.82, "MSFT": 0.91, "TSLA": 0.45 }` with `maxValueKey` -> `"MSFT"`.
