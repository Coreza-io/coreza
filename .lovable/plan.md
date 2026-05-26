# Repeater polish + unified Execute button

Three issues from the screenshot:
1. Inside If / Switch repeater rows the sub-fields render with **no label** above the inputs (left / operator / right look like anonymous boxes).
2. The repeater uses several different "Add" buttons (Add Condition / Add Case / Add Overlay / Add Field) with mixed sizes, variants and colors.
3. The primary submit button is inconsistent across node types — repeater nodes say **"Execute"** (blue) while regular nodes say **"Run"** (green). We want a single, visually polished primary button called **Execute** everywhere.

## Changes

### 1. Add labels to repeater sub-fields
- `src/nodes/If.json` → `conditions.subFields`: add `"label": "Value 1"`, `"label": "Operator"`, `"label": "Value 2"`.
- `src/nodes/Switch.json` → `cases.subFields`: same three labels plus `"label": "Output Name"` on `outputName`.
- FieldWrapper already renders the label when present; no renderer change needed.

### 2. New unified button variants in `src/components/ui/button.tsx`
Add three variants to `buttonVariants`:
- **`nodeAction`** — used for every "Add X" button. Glass surface adapting to light/dark:
  `bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 hover:border-primary/50 backdrop-blur-sm shadow-sm`.
- **`nodeIconGhost`** — square 28×28 ghost for row-remove ✕:
  `text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md`.
- **`nodeExecute`** — primary submit button used by **every** node type. Full-width, gradient primary surface with subtle glow, single consistent label "Execute":
  `w-full bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-semibold tracking-wide shadow-[0_4px_20px_-4px_hsl(var(--primary)/0.5)] hover:shadow-[0_6px_24px_-4px_hsl(var(--primary)/0.7)] hover:from-primary hover:to-primary transition-all`.

### 3. Apply unified buttons in `src/components/nodes/layout/RepeaterNodeLayout.tsx`
- All Add buttons → `<Button variant="nodeAction" size="sm">` with consistent `<Plus className="w-3.5 h-3.5" /> Add {entity}`.
- Move Switch "Add Case" under the case list (same shape as Conditions).
- Row-remove ✕ → `<Button variant="nodeIconGhost" size="icon" className="h-7 w-7">`.

### 4. Unify the Execute button
- `src/components/nodes/layout/RepeaterNodeLayout.tsx`: existing "Execute" submit → `variant="nodeExecute"`, strip hand-rolled blue classes.
- `src/components/nodes/layout/BasicNodeLayout.tsx`: existing "Run" submit → label changed to **"Execute"**, `variant="nodeExecute"`, strip hand-rolled green classes.
- Grep for any other submit-button sites in `src/components/nodes/layout/*` (e.g. trigger / dual-mode layouts) and apply the same variant + "Execute" label so every node shares one button.

### Out of scope
No schema, theming-CSS, or business-logic changes. Loading-spinner behavior on submit preserved.

## Files touched
- `src/components/ui/button.tsx`
- `src/components/nodes/layout/RepeaterNodeLayout.tsx`
- `src/components/nodes/layout/BasicNodeLayout.tsx`
- (any other layout file containing a node submit button — confirmed during edit pass)
- `src/nodes/If.json`
- `src/nodes/Switch.json`
