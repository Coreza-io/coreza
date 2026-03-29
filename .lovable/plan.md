

# Plan: Formalize `logicalOps` and Remove Dynamic Fields Block

## Feasibility Analysis

### How `logicalOps` flows today

1. **RepeaterNodeLayout.tsx** reads it from `fieldState.logicalOps` and writes it via `handleChange("logicalOps", ...)` and `handleFieldStateBatch({ logicalOps: [...] })`
2. **useNodeExecution.ts** (line 169) copies `fieldState.logicalOps` into the execution payload
3. **Backend comparator.ts** (line 30) reads `req.body.logicalOps` to combine condition results with AND/OR
4. **useNodeFieldState.ts** persists it only because the dynamic fields block catches it as an unknown key

### What `type: "hidden"` does

- **NodeFieldRenderer.tsx** (line 51): `if (field.type === "hidden") return null;` — no UI rendered
- **AIAgentExecutor.ts** (line 467): `if (field.type === "hidden") continue;` — skipped in backend field processing
- The field is still initialized, stored in `fieldState`, and synced to `data.values` — exactly what `logicalOps` needs

### Will anything break?

| Concern | Safe? | Why |
|---|---|---|
| RepeaterNodeLayout reads/writes `fieldState.logicalOps` | Yes | Field will exist in fieldState as a defined field with default `[]` |
| handleChange / handleFieldStateBatch | Yes | These work on any key in fieldState regardless of field type |
| useNodeExecution payload | Yes | Reads from `fieldState.logicalOps` — unchanged |
| Backend comparator | Yes | Receives `logicalOps` in payload — unchanged |
| Existing saved workflows with logicalOps data | Yes | On load, `savedValue ?? f.default` picks up the saved array |
| Other nodes (no logicalOps) | Yes | Only If.json gets this field; other nodes unaffected |

**Verdict: Fully feasible. No breaking changes.**

---

## Changes

### 1. `src/nodes/If.json` — Add `logicalOps` as hidden field

Add to the end of the `fields` array:

```json
{
  "key": "logicalOps",
  "label": "Logical Operators",
  "type": "hidden",
  "default": []
}
```

This ensures `logicalOps` is treated as a defined field — initialized from saved data or default `[]`, persisted normally.

### 2. `src/hooks/useNodeFieldState.ts` — Remove dynamic fields blocks

**Location 1: `useState` initializer (lines 73-80)**

Remove:
```ts
const existingValues = data.fieldState || data.values || {};
const definedKeys = new Set(definition.fields.map((f: any) => f.key));
const dynamicFields = Object.fromEntries(
  Object.entries(existingValues).filter(([key]) => !definedKeys.has(key)),
);

return { ...definedFields, ...dynamicFields };
```

Replace with:
```ts
return definedFields;
```

**Location 2: `useEffect` initializer (lines 113-122)**

Same removal — replace `{ ...definedFields, ...dynamicFields }` block with just `definedFields`.

### 3. Check for other nodes with dynamic keys

No other nodes use dynamic keys. Verified by search — `logicalOps` is the only key written to fieldState that isn't in a node definition.

---

## Result

- Stale renamed fields (e.g., `trail_percent`) are automatically dropped on load
- `logicalOps` continues to work identically — initialized, persisted, and sent to backend
- ~12 lines of fragile dynamic-field code removed
- 2 files changed, no backend changes needed

