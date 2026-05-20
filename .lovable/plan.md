# Pre-generate `workflowId` for new workflows

## Goal

On `/dashboard/workflow/new` (and template routes like `?template=custom`), generate a client-side UUID at editor mount so every node — including `AlpacaStreamData` — has a valid `workflowId` to send to the backend, without inserting a row into the `workflows` table until the user clicks Save.

## End-to-end flow

```text
User clicks "New"
   └─> /dashboard/workflow/new
        └─> WorkflowEditor mounts
             ├─ useParams().id = undefined  →  isNewWorkflow = true
             ├─ useState(() => crypto.randomUUID())  →  workflowId = "uuid-A"
             ├─ hasPersistedRef = false   (not yet saved)
             └─ nodeTypes closure passes workflowId to NodeRouter → BaseNode

User drags AlpacaStreamData, clicks Execute
   └─> POST /stream/alpaca/register  { workflowId: "uuid-A", nodeId, ... }
        └─> backend 200 OK, Redis keys scoped by "uuid-A"
        URL still /workflow/new, no DB row

User clicks Save (first time)
   └─> saveWorkflow(workflowId="uuid-A", isNew=true, ...)
        └─> INSERT INTO workflows (id, ...) VALUES ('uuid-A', ...)
        ├─ hasPersistedRef = true
        └─> navigate("/dashboard/workflow/uuid-A", { replace: true })

User clicks Save again
   └─> saveWorkflow(workflowId="uuid-A", isNew=false, ...)
        └─> UPDATE workflows SET ... WHERE id = 'uuid-A'
```

## Files to change

### 1. `src/pages/WorkflowEditor.tsx`

Replace the current `workflowId` initialization (lines 192–211):

```ts
const isNewWorkflow = id === "new" || !id;

// Always have a workflowId — generate one for new workflows.
const [workflowId, setWorkflowId] = useState<string | null>(() =>
  isNewWorkflow ? crypto.randomUUID() : (id ?? null)
);

// Track whether this workflowId has been persisted to the DB.
const hasPersistedRef = useRef<boolean>(!isNewWorkflow);

// Keep sync logic for URL → state when loading an existing workflow.
useEffect(() => {
  if (!isNewWorkflow && id && id !== workflowId) {
    setWorkflowId(id);
    hasPersistedRef.current = true;
  }
}, [id, isNewWorkflow, workflowId]);
```

In `handleSaveWorkflow` (around lines 778–801):

- Skip `checkNodeReduction` and `shouldBlockEmptySave` when `!hasPersistedRef.current` (no row to compare against).
- Pass an explicit `isNew` flag (or `presetId`) into `saveWorkflow` so it knows to INSERT with the pre-generated `id` instead of UPDATE.
- On success of the first save, set `hasPersistedRef.current = true` and navigate to `/dashboard/workflow/${workflowId}`.

```ts
const isFirstSave = !hasPersistedRef.current;
const result = await saveWorkflow(
  workflowId,
  workflowName,
  nodes,
  edges,
  { isNew: isFirstSave }
);

if (result.success && isFirstSave && workflowId) {
  hasPersistedRef.current = true;
  const workflowPath = `/dashboard/workflow/${workflowId}`;
  navigate(projectId ? `${workflowPath}?project=${projectId}` : workflowPath, {
    replace: true,
  });
}
```

Also: the autosave guard at line 1375 (`if (isNewWorkflow && nodes.length > 1)`) stays — we still do NOT auto-save; persistence only happens on explicit Save.

### 2. `src/hooks/useWorkflowPersistence.ts`

Extend `saveWorkflow` signature (line 158) with an options object:

```ts
const saveWorkflow = useCallback(
  async (
    workflowId: string | null,
    workflowName: string,
    nodes: Node[],
    edges: Edge[],
    opts: { isNew?: boolean } = {}
  ): Promise<{ success: boolean; newId?: string }> => {
    ...
    if (workflowId && !opts.isNew) {
      // existing UPDATE path (lines 210–221) unchanged
    } else {
      // INSERT — include the pre-generated id if provided
      const insertPayload = workflowId ? { ...payload, id: workflowId } : payload;
      const { data, error } = await supabase
        .from('workflows')
        .insert([insertPayload])
        .select()
        .single();
      ...
      return { success: true, newId: data.id };
    }
  }
);
```

Also gate `shouldBlockEmptySave` / `createVersionBeforeSave` on `!opts.isNew` so first-save doesn't query a non-existent row.

### 3. `src/components/nodes/BaseNode.tsx`

No changes — it already reads `propWorkflowId ?? routeWorkflowId`. As long as `WorkflowEditor` passes `workflowId` through the `nodeTypes` closure (which it does at line 1423 and 1591), the new UUID flows down correctly.

## Out of scope

- No backend changes.
- No auto-save on execute. DB row is only created when the user clicks the Save button.
- No change to template-loading logic in `Workflows.tsx` — `?template=custom` already navigates to `/workflow/new` which will now have a UUID at mount.
- Existing workflow load path (`/workflow/:id`) is unchanged.

## Verification

1. Open `/dashboard/workflow/new` → in React DevTools, `workflowId` state is a UUID; URL still `new`; no `workflows` row in DB.
2. Add `AlpacaStreamData` → click Execute. Network tab: `POST /stream/alpaca/register` body contains `workflowId: "<uuid>"`. Backend returns 200 (no more `400 workflowId is required`).
3. Click Save → `workflows` table gets one row with `id = <uuid>`. URL replaces to `/dashboard/workflow/<uuid>`. Refresh → same workflow loads.
4. Open same route via `?template=custom` → same behavior: UUID at mount, no DB row until Save.
5. Click Save a second time → row is UPDATEd in place, no duplicate insert, no new UUID.
