## Issues observed

From the screenshot, the canvas shows two nodes side by side:

- **BacktestInit** — uses `public/assets/icons/backtest.svg` (clock-rewind glyph). Its strokes extend almost edge-to-edge of the 24×24 viewBox, so it visually looks larger and slightly off-center compared to other node icons.
- **Compute** (Logic category) — uses `public/assets/icons/compute.svg`, which is literally a red rectangle with an "X" through it. It looks like a "delete/error" icon, not a compute/logic icon.

Both icons render through the same wrapper (`NodeWrapper.tsx`, `w-6 h-6` `<img>`), so the alignment difference comes from the SVG content itself, not the layout.

## Plan

### 1. Fix BacktestInit icon alignment

Update `public/assets/icons/backtest.svg` so its glyph sits inside the same safe area as other node icons (≈4px padding inside the 24×24 viewBox), matching the optical size of `if.svg`, `portfolio.svg`, `switch.svg`, etc.

Approach:
- Keep the clock-rewind concept (it is meaningful for "backtest" = replay history).
- Re-center the path inside `viewBox="0 0 24 24"` with the visible glyph sitting roughly within `x: 4–20, y: 4–20`.
- Keep the existing indigo stroke color `#6366F1` and `stroke-width="2"` for visual parity.

### 2. Replace the Logic / Compute icon

Replace `public/assets/icons/compute.svg` with a more meaningful glyph for the Logic category. The current red-X reads as "error/cancel".

Recommended new glyph: **function braces `{ƒ}`** or **sliders/equation** style — clean line-art, same 24×24 viewBox, same padding rules as above, using the existing accent color (e.g. `#F59E0B` amber, kept for Logic category continuity, or switched to a calmer hue if preferred).

Concretely, ship a new `compute.svg` that draws:
- left curly brace `{`
- centered lowercase `ƒ` or `x` glyph
- right curly brace `}`

This reads as "compute / expression / logic" instead of "delete".

No JSON changes needed — `Compute.json` already points to `/assets/icons/compute.svg`, so swapping the file is enough.

### Files to change

- `public/assets/icons/backtest.svg` — re-balanced clock-rewind glyph
- `public/assets/icons/compute.svg` — new function-braces glyph

### Out of scope

- Other category icons (If, Switch, Portfolio, etc.) — not part of this request.
- NodeWrapper / NodeRouter rendering logic — already correct, no code changes needed.
- Template hydration — already fixed in the previous turn.

### Verification

After the swap, on the workflow canvas:
- BacktestInit and Compute icons should appear at the same optical size and vertical alignment as If/Switch/Portfolio.
- The Compute node should show a clear function-braces glyph instead of the red X.
- Template chooser dialog (which also uses these SVGs at `h-6 w-6`) should look consistent.
