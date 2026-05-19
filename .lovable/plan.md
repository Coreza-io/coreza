# Stop the moving gradient shade on nodes

Every node in dark mode currently has a gradient that animates from one edge to the other in a 3s loop. The shade you see "transitioning" across the node is the `metallic-shimmer` keyframe applied to all `.dark .bg-gradient-*` utility classes in `src/index.css` (lines ~852–956).

The shimmer is built from three pieces on each node:

```css
background: var(--gradient-...);
background-size: 200% 200%;            /* canvas is 2x the node */
animation: metallic-shimmer 3s ease infinite;   /* slides 0% -> 100% -> 0% */
```

We want the gradient to stay, but be static.

## Change

In `src/index.css`:

1. Remove the `@keyframes metallic-shimmer { ... }` block (lines ~853–865).
2. For every `.dark .bg-gradient-*` rule (indicators, broker, data, logic, screener, input, visualization, llm, chatmodel, aiagent, email, tool, risk, scheduler, binance — lines ~868–956), drop both:
   - `background-size: 200% 200%;`
   - `animation: metallic-shimmer 3s ease infinite;`
   
   Keep the `background: var(--gradient-...);` line so each category still gets its colored gradient — it just renders once and stays put at the default `background-size` (100% 100%, no motion).

Nothing else changes: light mode is unaffected (these rules are `.dark`-scoped), node layout/handles/icons/labels are untouched, and other animations (`animate-pulse`, `animate-stream-data-flash`, electric border, edge animations) keep working because they don't depend on `metallic-shimmer`.

## Verification

- Open the editor in dark mode. Each node shows its category gradient, but the highlight no longer slides across — it's frozen.
- Switch to light mode: nodes look exactly as before (no `.dark` gradient rules applied).
- Execution flashing, selected glow, and animated edges still animate normally.
