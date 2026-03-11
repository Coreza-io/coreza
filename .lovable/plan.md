

# Replace Merge Mode Dropdown with Bottom Switch Toggle

Replace the current "Merge Mode" dropdown (at the top of the node form) with a compact switch/toggle placed at the bottom of the form, just above the Run button.

## Design

The switch will show "Continue on any input" label next to it. OFF = wait for all (default "all"), ON = continue on any ("any"). Only visible when 2+ incoming edges, same as current logic.

```
  ┌──────────────────────────────┐
  │  ... node fields ...         │
  │                              │
  │  ☐ Continue on any input     │  ← Switch toggle, bottom of form
  │  ┌──────────────────────────┐│
  │  │         Run              ││
  │  └──────────────────────────┘│
  └──────────────────────────────┘
```

## Changes

| File | Change |
|---|---|
| `src/components/nodes/layout/BasicNodeLayout.tsx` | Move merge mode from top `<Select>` (lines 201-217) to a `<Switch>` just above the Run button (before line 256). Switch checked = `fieldState.mergeMode === "any"`, onChange sets `"any"` or `"all"`. |
| `src/components/nodes/layout/RepeaterNodeLayout.tsx` | Same change: remove `<Select>` block (lines 518-535), add `<Switch>` above the submit button area (~line 958). |

Both files: remove `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` imports if no longer used. Add `Switch` import from `@/components/ui/switch`.

