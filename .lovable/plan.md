# Scope chart zoom to the chart, not the node

## Problem

When the cursor is over the Visualize chart inside a React Flow node and the user scrolls to zoom, both the chart's time scale **and** the React Flow canvas zoom (which scales the entire node). The wheel event bubbles up from the chart container to React Flow's pane handler.

## Fix

Stop wheel + touch gesture propagation at the chart wrapper so React Flow never sees those events when the cursor is inside the chart. Lightweight-charts already handles its own zoom/pan internally on the same events — we just need to prevent bubbling.

### `src/components/charts/LightweightVisualizeChart.tsx`

1. Wrap the outer returned `<div className="space-y-2 relative">` (or add a new wrapper) with handlers:
   ```tsx
   const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();
   ```
   Attach to the root wrapper:
   - `onWheelCapture={stopPropagation}` — blocks React Flow's wheel-to-zoom
   - `onPointerDownCapture` / `onMouseDownCapture` — prevents node drag when click-dragging on chart to pan
   - `onTouchStartCapture` — same for touch pinch/pan
   
   Use `*Capture` variants so the handler fires before any child handlers and propagation is stopped before React Flow's listeners (attached at the pane) see the event.

2. Alternative if React Flow uses native listeners (it does for wheel): attach a native non-passive wheel listener via `useEffect` on the root wrapper ref:
   ```ts
   const node = rootRef.current;
   const onWheel = (e: WheelEvent) => e.stopPropagation();
   node.addEventListener("wheel", onWheel, { passive: false });
   return () => node.removeEventListener("wheel", onWheel);
   ```
   This is the safer path because React's synthetic `onWheel` runs after the native one React Flow listens to. Use this approach.

3. Also add a `nodrag nowheel` className to the root wrapper. React Flow recognizes these built-in classes and will skip its own drag + wheel handling for any descendant — this is the cleanest, library-supported solution and pairs well with the native listener as a belt-and-suspenders fix.

### Verification

- Hover the price chart, scroll wheel → only the chart time scale zooms; node stays the same size.
- Hover a panel (RSI/ADX) chart, scroll → same: only that chart zooms.
- Move cursor outside the chart onto the node header/empty area, scroll → React Flow canvas zooms as before.
- Click-drag inside the chart → pans the chart, does not drag the node.
- Click-drag on the node header → still drags the node normally.
