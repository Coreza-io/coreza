# Restore chart wheel/touch interactions inside React Flow node

## What broke

The previous fix added four `*Capture` React handlers on the chart root plus `nowheel nodrag` classes:

```tsx
onWheelCapture={stopPropagation}
onPointerDownCapture={stopPropagation}
onMouseDownCapture={stopPropagation}
onTouchStartCapture={stopPropagation}
```

Capture-phase handlers run on the way **down** the DOM (root → canvas). Calling `stopPropagation` there halts the event before it reaches lightweight-charts' canvas listeners, so:

- Mouse wheel zoom: dead
- Two-finger pinch zoom: dead
- Click-drag pan / left-right scroll: dead
- Crosshair still works because that's a mousemove with no capture handler.

The only thing still functioning is the native `wheel` listener attached via `useEffect`, which runs in bubble phase and correctly stops propagation **after** the chart has handled it.

## Fix

Trust the two mechanisms that actually work and remove the ones that break the chart:

1. **`nowheel nodrag` classes** on the root — React Flow honors these and skips its own wheel/drag handling for any descendant. This alone is sufficient for React Flow's React-level handlers.
2. **Native bubble-phase `wheel` listener** on the root that calls `stopPropagation` — covers React Flow's native (non-React) wheel listener attached to the pane. Already in place.

### `src/components/charts/LightweightVisualizeChart.tsx`

- Delete the `stopPropagation` callback and all four `on*Capture` props from the root `<div>`.
- Keep `className="space-y-2 relative nodrag nowheel"`.
- Keep the existing `useEffect` that adds `wheel` with `{ passive: false }` and calls `stopPropagation` in bubble phase.
- Add a matching native bubble-phase listener for `touchstart` / `touchmove` with `stopPropagation` so pinch-zoom doesn't leak up to React Flow's native touch handlers on the pane. Use `{ passive: true }` so we don't block the chart's own touch handling. (No `preventDefault` — lightweight-charts needs the gesture.)

That's the entire change. Pointer/mouse down events on the node body are already handled by the `nodrag` class, so we don't need any JS for those.

### Verification

- Scroll wheel inside chart → chart zooms; node size unchanged.
- Scroll wheel outside chart but inside node → React Flow canvas zooms.
- Two-finger pinch on chart → chart zooms; node unchanged.
- Click-drag inside chart → chart pans left/right; node does not move.
- Click-drag on node header / empty node area → node drags as before.
- Crosshair hover → legend still updates per bar.
