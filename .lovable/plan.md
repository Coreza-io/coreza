## Three follow-up fixes

The "Glass obsidian" pass landed for basic-node inputs, but three real issues remain in the user's preview:

1. **Short Period / Long Period stack vertically** — the chosen prototype paired them in a `grid grid-cols-2`. Our renderer maps fields one-by-one with no pairing concept.
2. **Field text invisible (white on white)** — the value text shows up but the input surface stays white/light. Root cause: shadcn's `<Input>` carries `bg-background` and the existing `useNodeReferences.ts` injects an **inline** `style={{ backgroundColor: "hsl(var(--muted))" }}` for any `{{ }}` reference field. Inline style beats every Tailwind class, so `dark:bg-white/[0.03]` never wins for the most common case (reference inputs). Number inputs like "12" then also look mismatched because the same fields sit beside the white reference inputs.
3. **If / Switch (RepeaterNodeLayout) ignored** — it routes its inner fields through `NodeFieldRenderer` (good) but the surrounding chrome — `bg-muted/10` row wrappers, the inline `AND/OR` `<SelectTrigger>`, the dashed `<hr>` — are hand-rolled JSX that never received the dark-mode treatment.

## Root-cause shift

Instead of gating styling on the global `dark:` selector (fragile — inline `referenceStyle`, light-mode users with dark node bodies, and Repeater chrome all break it), tie it to the node card itself.

`NodeWrapper.tsx` already knows whether the card is rendered with the dark gradient (`isDarkMode`). Add `data-node-surface="dark"` to the `<Card>` when the dark gradient applies. Then write a small set of CSS rules in `src/index.css` scoped to `[data-node-surface="dark"] …` that always win — no `dark:` prefix needed, and they target inputs inside the card regardless of whether their value came from inline `style` (we'll specifically zero the `referenceStyle.backgroundColor` so the CSS rule wins).

## Plan

### Step 1 — Mark the dark node surface
`src/utils/NodeWrapper.tsx`
- On the `<Card>` (line ≈312), add `data-node-surface={isDarkMode ? "dark" : "light"}`. No visual change yet.

### Step 2 — Move glass styling to scoped CSS
`src/index.css` — append a new block:
```css
[data-node-surface="dark"] input,
[data-node-surface="dark"] textarea,
[data-node-surface="dark"] [data-slot="select-trigger"],
[data-node-surface="dark"] button[role="combobox"] {
  background-color: hsl(224 18% 14%) !important;
  border-color: hsl(0 0% 100% / 0.10) !important;
  color: hsl(210 40% 96%) !important;
  border-radius: 0.75rem;
  transition: all 0.2s ease;
}
[data-node-surface="dark"] input::placeholder,
[data-node-surface="dark"] textarea::placeholder {
  color: hsl(0 0% 100% / 0.25);
}
[data-node-surface="dark"] input:focus-visible,
[data-node-surface="dark"] textarea:focus-visible,
[data-node-surface="dark"] [data-slot="select-trigger"]:focus-visible {
  border-color: hsl(217 91% 60% / 0.55) !important;
  box-shadow: 0 0 0 4px hsl(217 91% 60% / 0.12);
  outline: none;
}
[data-node-surface="dark"] label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: hsl(215 16% 65%);
}
/* Reference-field tint (drag-and-drop expression chip) */
[data-node-surface="dark"] input[data-is-reference="true"],
[data-node-surface="dark"] textarea[data-is-reference="true"] {
  background-color: hsl(224 18% 18%) !important;
  border-bottom: 1px dashed hsl(217 91% 60%) !important;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 12px;
}
```
`!important` is intentional and necessary to beat inline `style` set elsewhere.

### Step 3 — Stop fighting with inline `referenceStyle`
`src/hooks/useNodeReferences.ts`
- Replace the inline `backgroundColor` / `borderBottom` with nothing — return `referenceStyle = {}` so the new CSS rules take over. Keep the prop signature unchanged for backward compat.

`src/components/nodes/layout/components/NodeFieldRenderer.tsx`
- On the `<Input>` and `<textarea>` add `data-is-reference={isReference || undefined}` so the CSS rule above can target them precisely.
- Remove the now-redundant `dark:` class chain (`glassInput`, `glassLabelClass`, the `cn(...)` wraps on Input/textarea/SelectTrigger/SelectContent/webhook input/label span). Restore the simpler classNames; the new CSS layer handles theming.

### Step 4 — Side-by-side field pairing
Schema convention: add `width: "half"` to field defs that should sit on a half-row.

- `src/nodes/VolumeOscillator.json` — add `"width": "half"` to `short_period` and `long_period`.
- `src/nodes/schemas/nodeSchema.ts` — add optional `width: z.enum(["full","half"]).optional()` to the field schema.

`src/components/nodes/layout/BasicNodeLayout.tsx` (line 120 map)
- Replace the flat `.map((f) => <NodeFieldRenderer …/>)` with a small grouping pass that collects consecutive `width === "half"` fields and wraps each pair in `<div className="grid grid-cols-2 gap-3">`. Pseudocode:
  ```ts
  const groups = [];
  let buffer = [];
  for (const f of definition.fields ?? []) {
    if (f.width === "half") { buffer.push(f); if (buffer.length === 2) { groups.push({type:"row", fields: buffer}); buffer = []; } }
    else { if (buffer.length) { groups.push({type:"row", fields: buffer}); buffer = []; } groups.push({type:"single", field: f}); }
  }
  if (buffer.length) groups.push({type:"row", fields: buffer});
  ```
- Render each `row` group inside a grid wrapper.

### Step 5 — Bring RepeaterNodeLayout chrome under the same roof
`src/components/nodes/layout/RepeaterNodeLayout.tsx`
- The inner fields already route through `NodeFieldRenderer`, so they inherit the new CSS automatically.
- For hand-rolled chrome:
  - Row container (lines 680, 792, 912): change `bg-muted/10` → `bg-white/[0.03] border-white/10` (these classes resolve correctly because the parent `[data-node-surface="dark"]` keeps everything readable; light mode keeps `bg-muted/10`-equivalent via a `light:` companion if needed — but since these wrappers render inside the dark card, scope it with `[data-node-surface='dark']`-friendly classes).
  - The inline `<SelectTrigger className="w-20 h-8 text-xs">` for AND/OR (line 668) and any other inline trigger pick up the CSS rule from Step 2 automatically (they're `<button data-slot="select-trigger">`).
  - The `<hr className="flex-1 border-t" />` (line 676): change to `border-white/10`.

### Step 6 — QA
- Open Volume Oscillator in dark mode: text values are readable (light slate-200 on `#1f2540`-ish surface), Short / Long Period sit side-by-side, labels are tiny uppercase slate, reference inputs show the mono dashed-underline treatment.
- Open If or Switch: AND/OR pill, condition rows, and inputs all read against the dark card the same way.
- Switch to light mode: `data-node-surface="light"` so the CSS block from Step 2 doesn't fire, light theme renders exactly as before.

## Files touched
- `src/utils/NodeWrapper.tsx` — add `data-node-surface` attr (1 line).
- `src/index.css` — append scoped CSS block (~40 lines).
- `src/hooks/useNodeReferences.ts` — empty `referenceStyle` object.
- `src/components/nodes/layout/components/NodeFieldRenderer.tsx` — strip the `dark:`/`glassInput`/`glassLabelClass` layer, add `data-is-reference` attr.
- `src/components/nodes/layout/BasicNodeLayout.tsx` — half-width grouping.
- `src/components/nodes/layout/RepeaterNodeLayout.tsx` — recolour hand-rolled chrome (`bg-muted/10`, `<hr>`).
- `src/nodes/VolumeOscillator.json` — add `width: "half"` to short/long period.
- `src/nodes/schemas/nodeSchema.ts` — allow optional `width` enum.

No backend, no DB, no migrations.
