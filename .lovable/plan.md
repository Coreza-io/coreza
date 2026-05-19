# Smooth edges (no orthogonal step turns)

The reference image shows a clean S-curve between two nodes. Today, edges going forward already use a bezier curve, but any "backward" route (target placed behind/above source) falls back to an orthogonal 5-segment path with small rounded corners — that's the visible right-angle "step" the user wants gone.

## Where the step routing lives

`src/components/workflow/EdgeManager.tsx` — function `calculateSmartPath` (~lines 247–530). For each handle-pair direction (Right→Left, Left→Right, Bottom→Top, Top→Bottom) it branches:

- `isBackward` true → calls `buildOrthogonalPath(...)` (the helper at lines 174–245) producing `M ... L ... Q ... L ...` with right-angle turns.
- `isBackward` false → already uses `getBezierPath(...)` — smooth.

The default fallback at line 517 also uses `getBezierPath`.

## Change

In `EdgeManager.tsx`, replace every `buildOrthogonalPath(...)` branch with a smooth bezier route, so every edge — forward or backward — uses curves only.

1. For each of the four backward branches (Right→Left, Left→Right, Bottom→Top, Top→Bottom), drop the orthogonal block and call `getBezierPath` with the same `sourceX/Y/Position` and `targetX/Y/Position`. React Flow's bezier helper already produces a clean S-curve when the target is behind the source (matches the second reference image).
2. Compute `midX = (sourceX + targetX) / 2` and `midY = (sourceY + targetY) / 2` for the edge label position (same as the existing forward branches).
3. Delete the now-unused `buildOrthogonalPath` helper (lines 174–245) and the `turnOffset` / `radius` / `nodePadding` locals that only fed it. Keep `sourceNode`/`targetNode` lookups only if still referenced — otherwise simplify the function body.
4. No changes to the edge component itself (stroke, animation, plug overlays, label rendering) — only the path string source changes.

## Verification

- A backward connection (e.g. Switch `Fallback` handle wrapping back to an earlier node) renders as a smooth curve like reference image 2, with no right-angle segments.
- Forward connections look identical to before.
- Edge labels stay roughly centered on the new path.
- Animated/executing edge styles, plug icons, and hit areas still render correctly because the same `edgePath` string is fed into all `<path d={edgePath}>` elements.
- No console errors after switching nodes around and creating loops.
