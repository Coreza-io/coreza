# Add dynamic labels to Switch node handles

Same pattern as the AI Agent handle labels, but the labels for Switch come from the user's case configuration instead of being hardcoded in the node JSON. The reference screenshot shows two cases (`market`, `order_update`) plus an `Enable Fallback` toggle — each of these should render its name beside the matching output handle on the right side of the node.

## Where the handles are built

`src/components/nodes/NodeRouter.tsx` (lines ~148–220) already generates Switch output handles dynamically:

- One `source` handle on the right per entry in the `cases` repeater, with `id = caseItem.outputName || caseN`.
- One extra `source` handle (`fallbackHandleId`) when `enableFallback` is on.
- A single `target` handle (`input`) on the left.

Today these handles have no `label` property, so `NodeWrapper` renders them without text. The `HandleConfig` type in `src/utils/NodeWrapper.tsx` already supports `label?: string` (added for AI Agent), so this change is purely about populating it.

## Change

In `src/components/nodes/NodeRouter.tsx`, inside the `handles` `useMemo` for Switch nodes:

1. **Defaults branch (no user cases yet)** — when mapping `defaultCases` into handles, also set:
   - `label: caseItem.outputName || \`Case ${index + 1}\``
   And for the fallback entry: `label: "Fallback"`.

2. **Main branch (user has configured cases)** — in the `cases.forEach` loop, derive a display label from the same fields used for the handle id, with a friendly fallback:
   ```ts
   const handleLabel =
     caseItem.outputName ||
     caseItem.caseName ||
     caseItem.caseValue ||
     `Case ${index + 1}`;
   ```
   Pass it as `label: handleLabel` on the pushed handle object.

3. **Fallback handle** — when `fallbackEnabled`, push with `label: "Fallback"`.

4. The left `input` handle stays unlabeled (matches AI Agent's input/output behavior and the screenshot).

5. Labels update reactively because the `useMemo` already depends on `data.fieldState?.cases` and `data.values?.cases`. Renaming a case's `outputName` re-renders the handle with the new label automatically. No extra dependency needed.

## Rendering

No changes to `NodeWrapper.tsx`. It already renders `h.label` next to each handle along the correct axis (right-side handles get the label to the right of the dot) with `text-[10px] text-muted-foreground pointer-events-none`, so existing drag/connect behavior is unaffected.

## Verification

- Open a Switch node with two cases named `market` and `order_update` and fallback enabled. Right side shows three handle labels stacked vertically: `market`, `order_update`, `Fallback`.
- Rename a case in the repeater → the handle label updates live.
- Add a new case → a new labeled handle appears; remove a case → its handle disappears.
- Disable `Enable Fallback` → the `Fallback` handle and its label disappear.
- Light and dark themes both readable.
- AI Agent node and all other nodes unchanged (they don't go through the Switch branch).
- Existing edges connected by `sourceHandle` keep working because handle `id` values are unchanged — only `label` was added.
