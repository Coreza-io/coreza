# Make AI Agent collapsed node wider (n8n-style)

Today every collapsed node renders in the same square 200×150 footprint, which makes the AI Agent feel cramped — the bot icon and "AI Agent" label are stacked vertically and the bottom-handle labels (`Chat Model*`, `Memory`, `Tool`) sit right under the icon. In n8n the agent card is a wide rectangle with the icon on the left and the title beside it, leaving room below for the three handle labels.

## Changes

### 1. Drive collapsed size from the node definition

`src/utils/NodeWrapper.tsx` currently hardcodes the collapsed size:

```tsx
${isExpanded ? "" : "w-[150px] h-[100px] cursor-pointer group"}
...
style={{
  width: isExpanded ? minWidth : 200,
  minHeight: isExpanded ? minHeight : 150,
  height: isExpanded ? "auto" : 150,
  ...
}}
```

Add optional `collapsedSize?: { width: number; height: number }` support, sourced from `definition.collapsedSize` (passed down via `NodeRouter` / `BaseNode` as a new prop, alongside the existing `size` used for the expanded view). When present, the collapsed `<Card>` uses those dimensions instead of the 200×150 default. All other nodes keep the current square footprint because they don't define `collapsedSize`.

### 2. Horizontal (icon-left) collapsed layout for AI Agent

When `collapsedSize` is set and its `width` is meaningfully larger than its `height` (e.g. ratio ≥ 1.6), switch the collapsed body from the existing vertical `flex flex-col items-center justify-center` to a horizontal layout:

```tsx
<div className="flex flex-row items-center gap-3 h-full px-5 select-none relative group">
  <div className="text-muted-foreground shrink-0">{icon}</div>
  <div className="font-semibold text-sm text-foreground leading-tight truncate">
    {label}
  </div>
</div>
```

Existing overlays (execution status badge top-left, duration top-right, delete button, tool-mode toggle, rename input, TOOL badge, item count) remain absolutely positioned — they don't depend on the inner flex direction, so they keep working unchanged.

### 3. Opt AI Agent in

`src/nodes/AIAgent.json` — add a `collapsedSize` next to the existing expanded `size`:

```json
"size": { "width": 380, "height": 420 },
"collapsedSize": { "width": 320, "height": 110 }
```

That gives the n8n-style wide card: ~320px across, ~110px tall, with icon + "AI Agent" on one row and clear space below for the three handle labels.

### 4. Handle positions still derive from percentages

Handles in `NodeWrapper` are positioned with `((idx + 1) / (group.length + 1)) * 100%`, so the three bottom handles automatically spread across the wider card and their labels (`Chat Model*`, `Memory`, `Tool`) sit evenly under them without further changes.

## Verification

- AI Agent collapsed: card is ~320×110, icon on the left, "AI Agent" label beside it, edit pencil still appears when selected.
- Bottom handles spread evenly across the wider node; labels stay centered under each handle and don't collide.
- Left input and right output handles still attach to the vertical center of the card.
- All other nodes (Compute, If, Switch, indicators, brokers, ChatModel, Memory, Tool nodes) render at the existing 200×150 collapsed size — no regressions.
- Expand/collapse, rename (F2/double-click), delete, tool-mode toggle, execution status badge, duration, TOOL badge, and electric border all still render correctly on the wider AI Agent card.
