
Goal: fix the actual state flow so newly added node fields become part of React Flow node.data.values and then persist normally to DB, instead of masking the issue with save-time defaults.

What I found end-to-end

1. Load path from DB into React Flow
- `src/hooks/useWorkflowPersistence.ts:294-309`
- Existing workflows are restored with:
  - `definition` from `nodeManifest`
  - `data.values` from DB only: `(node as any).values || node.data?.values || {}`
- No reconciliation happens here between current node definition fields and old persisted values.

2. Why manual run works but live/save stays stale
- `src/components/nodes/BaseNode.tsx` manual execution uses `useNodeFieldState(...)`
- `useNodeExecution` receives `fieldStateHook.fieldState`, not raw `node.data.values`
- So manual run works because UI-local `fieldState` includes newly added fields/defaults.

3. Why save/live still miss the field
- Save path in `src/hooks/useWorkflowPersistence.ts:85-103` serializes only `n.data.values`
- Live execution also depends on persisted `node.values` from DB
- Therefore if React Flow state never got the new field into `node.data.values`, save just writes the same old shape back.

4. The real bug in React Flow state sync
- `src/hooks/useNodeFieldState.ts`
- The hook initializes local `fieldState` from definition + saved values.
- It is supposed to sync that local state back into React Flow `node.data.values`.
- But there is a logic bug:
  - init effect sets `hasInitialized.current = true`
  - then another effect immediately resets it:
    - `useEffect(() => { hasInitialized.current = false; }, [definition?.name])`
- On mount for an existing node, both run for the same definition.
- Result: the sync effect guarded by `!hasInitialized.current` often skips, so the derived field never gets written back to React Flow node state.
- That matches your symptom exactly:
  - UI/manual execution sees the new field
  - DB/save/live do not

Why this matters
- The issue is not “default values” as a product decision.
- The issue is architectural inconsistency:
  - source of truth for save/live = `node.data.values`
  - source of truth for manual execution = `fieldState`
- These two drift because initialization-to-React-Flow sync is broken.

Implementation plan

1. Fix `useNodeFieldState` lifecycle so initialization writes through to React Flow
File:
- `src/hooks/useNodeFieldState.ts`

Changes:
- Remove the mount-time reset pattern that flips `hasInitialized` back to `false` right after initialization.
- Replace current init logic with a deterministic reconciliation flow:
  - compute merged state from definition fields + existing `data.values`/`data.fieldState`
  - set local `fieldState`
  - immediately sync merged state into React Flow node `data.values` and `data.fieldState` when missing keys were discovered
- Ensure this runs:
  - on mount
  - when node definition changes meaningfully
  - without causing infinite loops or clobbering user edits

2. Make initialization idempotent and key-aware
File:
- `src/hooks/useNodeFieldState.ts`

Changes:
- Stop using only `definition?.name` / `fields.length` as the init trigger
- Track a lightweight schema signature such as:
  - field keys
  - field types
  - maybe option ids for structural select changes
- Reconcile only missing/new fields into node state instead of treating every render as a full reset

3. Preserve user data while backfilling new fields
Behavior to enforce:
- If DB already has a value, keep it
- If DB lacks a newly added field, add it into both:
  - local `fieldState`
  - React Flow `node.data.values`
- Do not overwrite existing saved values
- Do not require opening the node and manually changing anything before save

4. Apply the same hydration fix to workflow-version restore path
File:
- `src/pages/WorkflowEditor.tsx`
- `handleRestoreFromVersion`

Why:
- This restore path repeats the same old pattern:
  - `values: (node as any).values || node.data?.values || {}`
- It should use the same node reconciliation strategy as normal workflow load so restored versions also hydrate newly added fields into React Flow state.

5. Keep backend safety net, but as defense-in-depth only
File:
- backend parameter resolver / workflow engine path already discussed

Why:
- Frontend fix is the real solution for persistence
- Backend fallback is still useful for old workflows that haven’t been reopened/saved yet
- But backend should not be the primary fix for your reported bug

Expected result after implementation

For an old workflow like your BinanceTrade example:
```text
DB load
  -> React Flow node restored with old values
  -> useNodeFieldState reconciles against current node schema
  -> missing `operation` is inserted into node.data.values
  -> user saves workflow
  -> DB now stores `operation`
  -> live execution sees it in node.values
```

Files to update
- `src/hooks/useNodeFieldState.ts`
- `src/pages/WorkflowEditor.tsx` (restore-from-version hydration path)
- optionally a shared helper for “reconcile node values with current definition” to avoid duplicating logic across load/init paths
- backend engine resolver as a safety net only

Technical note
The cleanest implementation is to centralize reconciliation in a helper, e.g.:
```text
reconcileNodeValues(definition, existingValues, existingFieldState)
```
and use it in:
- `useNodeFieldState`
- workflow load/restore hydration paths if needed

This avoids three different places inventing different rules for what a node’s values should look like.
