# Add labels under AI Agent handles

Reference image shows each handle on the AI Agent node carrying a small text tag (e.g. `Chat Model*`, `Memory`, `Tool`) just outside the node, with a red `*` for required slots. Today our handles have no visible label, so users can't tell which bottom port is `chatModel`, `memory`, or `tool`. We'll add an opt-in label per handle and turn it on for AI Agent.

## Changes

### 1. Handle config supports `label` and `required`

Extend the `HandleConfig` type read by `NodeWrapper` (`src/utils/NodeWrapper.tsx`) so each handle entry may carry:

- `label?: string` — display text (e.g. "Chat Model"). Falls back to nothing when absent (preserves existing nodes' look).
- `required?: boolean` — when true, append a red `*` after the label.

No changes to how `id`, `type`, `position` work. Existing handles without `label` render exactly as today.

### 2. Render the label in `NodeWrapper`

Inside the handles map (around line 390 where `<Handle>` is returned), when `h.label` is set, render a small `<span>` positioned just outside the node along the handle's axis:

- `position: "bottom"` → label below the handle, centered horizontally
- `position: "top"` → label above the handle
- `position: "left"` → label to the left of the handle, right-aligned
- `position: "right"` → label to the right of the handle, left-aligned

Styling uses semantic tokens so it themes in both light/dark:

```tsx
<span
  className="absolute text-[10px] font-medium text-muted-foreground whitespace-nowrap pointer-events-none nodrag select-none"
  style={positionStyle}
>
  {h.label}
  {h.required && <span className="text-destructive ml-0.5">*</span>}
</span>
```

The label is a sibling of `<Handle>` inside the same positioned wrapper (or rendered as a child of `<Handle>` with absolute positioning relative to the handle's 24×24 box). Offset of ~14px keeps the text clear of the plug icon. It uses `pointer-events-none` so it never blocks drag/connect on the handle.

### 3. Update `src/nodes/AIAgent.json` handles

```json
"handles": [
  { "type": "target", "position": "left",   "id": "input" },
  { "type": "target", "position": "bottom", "id": "chatModel", "label": "Chat Model", "required": true },
  { "type": "target", "position": "bottom", "id": "memory",    "label": "Memory" },
  { "type": "target", "position": "bottom", "id": "tool",      "label": "Tool" },
  { "type": "source", "position": "right",  "id": "output" }
]
```

`input` and `output` stay unlabeled to match the reference image (only the bottom slots get tags). If we want them labeled later, the same mechanism applies.

### 4. Scope

Only AI Agent gets labels in this change. Other nodes are untouched because their handles don't set `label`. We can opt other multi-port nodes in later (e.g. Switch case outputs) by adding `label` to their handle entries.

## Verification

- Open the AI Agent node in the editor (collapsed and expanded). Bottom row shows `Chat Model*`, `Memory`, `Tool` directly under their respective handles. `*` is red.
- Labels remain readable in light and dark themes (use `text-muted-foreground` + `text-destructive`).
- Dragging from / dropping onto a handle still works (label is `pointer-events-none`).
- Other nodes (Compute, If, Switch, indicators, brokers) render unchanged — no labels appear because their handle configs don't define `label`.
