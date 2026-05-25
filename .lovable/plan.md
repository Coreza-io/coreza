## Goal

Apply the selected **"Glass obsidian"** direction to the form fields rendered inside expanded node cards (Volume Oscillator screenshot is the reference), and remove the muted helper paragraphs that appear under every field. Light mode stays exactly as it is today.

## Design tokens (copied verbatim from the selected prototype)

| Slot | Class chain |
|------|-------------|
| Input / select / textarea surface | `dark:bg-white/[0.03] dark:border-white/10 dark:text-blue-100 dark:placeholder-white/20` |
| Number / select text color | `dark:text-white` (overrides `text-blue-100` for these two field types) |
| Radius + padding | `rounded-xl px-3 py-2.5` |
| Focus state | `focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200` |
| Field label | `text-[11px] font-bold uppercase tracking-wider text-slate-400` (dark only — light keeps current `<Label>`) |
| Expression-style text inputs (`text` / `string` types whose value is a `{{ }}` reference) | add `font-mono text-xs truncate` |
| Select dropdown chevron | absolute right-3 icon, `text-white/30` in dark |

All classes are gated with the `dark:` prefix so the light theme renders identically to today.

## Files to change

Single file: `src/components/nodes/layout/components/NodeFieldRenderer.tsx`.

### Step 1 — Remove in-node field descriptions
- In the final `<FieldWrapper>` (≈ lines 840–857) pass `description={undefined}` unconditionally. The `field.description` prop is still consumed elsewhere (docs panel, AI tooling), so leave the schema field alone.
- In the `toggle` branch (≈ lines 696–715) delete the `{field.description && shouldShowDescription && (...)}` block. Keep the label and switch.

### Step 2 — Centralise the glass-input class chain
Add a single constant near the top of `renderField()`:
```ts
const glassInput =
  "dark:bg-white/[0.03] dark:border-white/10 dark:text-blue-100 " +
  "dark:placeholder:text-white/20 dark:focus:border-blue-500/50 " +
  "dark:focus:ring-4 dark:focus:ring-blue-500/10 transition-all duration-200 " +
  "rounded-xl";
```
Then thread it through:
- `commonInputProps.className` becomes `cn("nodrag", glassInput, isReference && "font-mono text-xs truncate")`. This catches the `text` / `string` / `number` / `password` `<Input>` at line 404 and the `<textarea>` at line 427.
- `<textarea>` className: drop the existing hard-coded `border border-input bg-background text-foreground placeholder:text-muted-foreground` chain and reuse `cn("w-full p-2 text-sm min-h-[100px] nodrag focus-visible:outline-none", glassInput)`.
- `<SelectTrigger className="w-full">` (line 381) → `cn("w-full nodrag", glassInput, "dark:text-white")`.
- `<SelectContent>` → add `className="dark:bg-popover dark:border-white/10"` so the open dropdown stays on a dark surface when it portals out.
- Webhook URL `<Input>` (line 340) keeps `bg-muted` for the read-only feel but also gets `dark:bg-white/[0.05] dark:border-white/10 dark:text-blue-100 rounded-xl`.

### Step 3 — Tighten the label style in dark mode
`FieldWrapper` already renders `<Label>` from shadcn. Inside `NodeFieldRenderer`, wrap the label string passed into `<FieldWrapper>` with a span carrying `dark:text-slate-400 dark:font-bold dark:uppercase dark:tracking-wider dark:text-[11px]`. Light mode keeps the default Label styling because every class is `dark:`-prefixed.

### Step 4 — Visual QA
- Volume Oscillator node in dark mode → inputs are translucent (`white/[0.03]`) with thin borders, labels are tiny uppercase slate, expression fields render in mono, dropdown opens onto a dark popover, no helper paragraphs anywhere.
- Toggle to light mode → fields look identical to current production (white inputs, normal labels), proving every override is `dark:`-scoped.
- Other node types (EMA, RollingWindow, AlpacaOrder) inherit the same treatment because the renderer is shared.

## Out of scope
- Node card header, neon border, handles, gradient body, and Run button — untouched.
- `FieldWrapper.tsx`, `Input.tsx`, `Select.tsx`, and `index.css` tokens — untouched.
- No backend, schema, or memory changes.
