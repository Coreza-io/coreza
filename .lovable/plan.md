
## Convert Node Palette to Collapsible Category Dropdowns

### What Changes

**File: `src/components/workflow/NodePalette.tsx`**

Currently all categories are always expanded, showing every node at once. This makes the palette long and hard to navigate.

The change converts each category header into a clickable accordion row with a chevron icon. Clicking a category toggles its node list open/closed.

### Behavior

1. **Default state**: All categories collapsed (just category names with node count and chevron-right icon visible).
2. **Click a category**: It expands to reveal its nodes with a smooth animation (chevron rotates to chevron-down).
3. **Multiple open**: Allow multiple categories open simultaneously (not mutually exclusive).
4. **Search override**: When the user types in the search box, all matching categories auto-expand so results are visible. When search is cleared, categories return to their previous collapsed/expanded state.
5. **Node count badge**: Show the number of nodes in each category next to the name (e.g., "Indicators (8)").

### Implementation Details

- Add `expandedCategories` state (`Set<string>`) to track which categories are open.
- Replace the static `<h4>` category header with a clickable `<button>` containing the category name, node count, and a `ChevronRight`/`ChevronDown` icon.
- Wrap the node list `<div>` in a conditional render based on whether the category is in the expanded set.
- Use `framer-motion`'s `AnimatePresence` + `motion.div` with height animation for smooth expand/collapse.
- When `searchQuery` is non-empty, render all matching categories as expanded regardless of the `expandedCategories` state.
- Add appropriate category-specific icons (e.g., `TrendingUp` for Indicators, `DollarSign` for Broker, `GitBranch` for ControlFlow, etc.) instead of using `BarChart3` for everything.

### No other files change. No backend changes.
