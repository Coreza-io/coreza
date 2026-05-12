# Workflow Template Picker on New Workflow

## Goal
When the user clicks **New Workflow**, open a modal offering three starter templates. The chosen template seeds the editor's nodes/edges. "Custom" preserves today's default (single FinnHub welcome node).

## UX flow

1. On `/dashboard/workflows`, the **New Workflow** button no longer navigates immediately. It opens a `TemplateChooserDialog`.
2. Dialog shows three cards in a responsive grid:
   - **Backtest** – icon `backtest.svg`, copy: "Historical strategy simulation with BacktestInit + indicators + portfolio."
   - **Stream** – icon `broker.svg`, copy: "Live market stream with real-time signals and order routing."
   - **Custom** – icon `compute.svg`, copy: "Start from a blank canvas with one starter node."
3. Selecting a card navigates to `/dashboard/workflow/new?template=<backtest|stream|custom>` (preserving `?project=` if present).
4. `WorkflowEditor` reads the `template` query param on first load and seeds nodes/edges from the matching template instead of `initialNodes`.
5. The same dialog opens from the empty-state "Create Your First Workflow" button.

## Templates

Templates live as static JSON in `src/templates/workflows/`:

```text
src/templates/workflows/
  backtest.json     # pre-built backtest pipeline
  stream.json       # pre-built live stream pipeline
  custom.json       # equivalent to today's initialNodes (single FinnHub welcome)
  index.ts          # typed registry: { backtest, stream, custom }
```

Each JSON matches the existing workflow export shape (`{ nodes: Node[], edges: Edge[] }`) so it round-trips cleanly through `stampNodesWithWorkflowSession` and the editor.

For initial content:
- `custom.json` = the current `initialNodes` array (FinnHub "Welcome to Coreza!" node) + empty edges. No behavior change for users who pick Custom.
- `backtest.json` = minimal but runnable: `BacktestInit` → `RSI` indicator → `IF` → `Portfolio` (place_order) with sensible defaults and connecting edges.
- `stream.json` = minimal: `Alpaca` (or `Binance`) market subscription stream node → `RSI` → `IF` → `Portfolio`.

Node IDs in JSON use stable slugs (e.g. `bt-init`, `bt-rsi`); on load we run them through `stampNodesWithWorkflowSession` (already handles per-session re-stamping). Positions are pre-laid-out left→right so the canvas looks tidy on first open.

## Files to add

- `src/components/workflow/TemplateChooserDialog.tsx` — shadcn `Dialog` with 3 selectable cards, accepts `open`, `onOpenChange`, `onSelect(templateId, projectId?)`. Uses framer-motion for hover lift, semantic tokens only.
- `src/templates/workflows/custom.json`
- `src/templates/workflows/backtest.json`
- `src/templates/workflows/stream.json`
- `src/templates/workflows/index.ts` — exports a typed `workflowTemplates` map and a `TemplateId = 'backtest' | 'stream' | 'custom'` type; loads JSON via `import` so Vite bundles them.

## Files to edit

- `src/pages/Workflows.tsx`
  - Replace the `<Link to="/dashboard/workflow/new">` wrappers around both **New Workflow** buttons with `<Button onClick={() => setTemplateDialogOpen(true)}>`.
  - Add `templateDialogOpen` state and render `<TemplateChooserDialog>`.
  - On select: `navigate(\`/dashboard/workflow/new?template=${id}${projectId ? \`&project=${projectId}\` : ''}\`)`.

- `src/pages/WorkflowEditor.tsx`
  - Read `searchParams.get('template')` (default `'custom'`).
  - Replace the hardcoded `initialNodes` reference inside `doLoad()`'s `isNewWorkflow` branch with a lookup into `workflowTemplates[templateId]`, falling back to `custom`.
  - Keep the module-level `initialNodes` only as the default for `useNodesState` initial render (or change it to `workflowTemplates.custom.nodes`); the real seeding happens in the effect.
  - No other behavior changes — `stampNodesWithWorkflowSession` and existing save flow handle the rest.

## Out of scope

- No backend/database changes — templates are bundled client-side JSON.
- No template management UI (create/edit/delete user templates).
- No changes to existing workflows or the executor/runtime.
- No new node types; templates only compose existing nodes from `nodeManifest`.

## Technical notes

- Template JSON is validated lightly at load time: if a template references a node `type` not in `nodeManifest`, fall back to `custom` and toast a warning (defensive against renamed nodes).
- Dialog opens on the same route, so deep-linking `/dashboard/workflow/new?template=backtest` (e.g. from docs) also works without going through the picker.
- All visuals use semantic tokens (`bg-card`, `border-border`, `text-muted-foreground`, `bg-gradient-primary`); no hardcoded colors.
