

# Updated Plan: `useWorkflowPersistence` + `getVisibleValues` Fix

## Key Finding

`WorkflowEditor.tsx` line 760 saves **raw values** without filtering hidden fields:
```ts
values: n.data.values ?? n.data.fieldState ?? {},
```

Meanwhile, `useWorkflowState.ts` (the dead code) correctly uses `getVisibleValues()` at line 186 to strip values of fields hidden by `displayOptions`. This is the **one useful thing** in the dead file — and it's not being used.

## Impact

Without `getVisibleValues`, saved workflows contain stale values from fields that were visible at one point but later hidden (e.g., user selects "market" order type, the "limit price" field hides, but its old value still gets saved). This can cause confusion on reload or bugs during execution if those phantom values are read.

## Plan (addition to previous plan)

Everything from the previous plan stays. Add this:

### In `useWorkflowPersistence.ts` (new hook)

Import and use `getVisibleValues` from `@/utils/fieldVisibility` in the save serialization:

```ts
import { getVisibleValues } from '@/utils/fieldVisibility';

// Inside saveWorkflow:
const minimalNodes = nodes.map(n => ({
  id: n.id,
  name: (n.data.definition as any)?.name,
  node_type: (n.data.definition as any)?.node_type,
  category: (n.data.definition as any)?.category,
  subCategory: (n.data.definition as any)?.subCategory,
  provider: (n.data.definition as any)?.provider,
  position: n.position,
  sourcePosition: n.sourcePosition,
  targetPosition: n.targetPosition,
  values: getVisibleValues(
    n.data.definition as any,
    (n.data.values as Record<string, any>) || {}
  ),
  executionMode: (n.data.definition as any)?.executionMode,
  streamingConfig: (n.data.definition as any)?.streamingConfig,
}));
```

### Summary of all changes

| File | Change |
|---|---|
| `src/hooks/useWorkflowPersistence.ts` | **New** — save/load/unsaved-changes hook, uses `getVisibleValues` for clean serialization |
| `src/hooks/useWorkflowState.ts` | **Delete** — dead code |
| `src/pages/WorkflowEditor.tsx` | Replace inline save/load with `useWorkflowPersistence`. Line 760 raw `values` replaced by `getVisibleValues` call via the new hook. ~200 lines removed. |

