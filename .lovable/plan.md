
## Optimize NodePalette Performance and UX

**File: `src/components/workflow/NodePalette.tsx`**

### 1. Memoize static computations

- Wrap `filteredNodes` in `useMemo` with `[searchQuery]` dependency (nodeManifest is static).
- Extract `categories` computation into a module-level constant (it never changes).

### 2. Memoize callbacks

- Wrap `onDragStart` in `useCallback`.

### 3. Cap stagger animation

- Cap the stagger delay at 10 items: `delay: Math.min(index, 10) * 0.03` so nodes beyond the 10th appear instantly with the 10th.

### 4. Disable toggle during search

- In the category button's `onClick`, skip `toggleCategory` when `isSearching` is true. This prevents the hidden Set mutation that has no visible effect and could cause confusing behavior when the search is cleared.
