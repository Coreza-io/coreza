# Fix: IF node left/right fields too narrow to read

## Problem

The IF node is fixed at `width: 340` in `src/nodes/If.json`. Each condition row currently uses a single-row grid:

```
grid-cols-1 md:grid-cols-[1.5fr_auto_1.5fr_auto]
```

which packs `left`, `operator`, `right`, and the delete button into one line. With a ~340 px node, that leaves only ~80 px for each of `left` and `right`, so dragged-in references like `{{ $('Market Status').json.market_type }}` get truncated to `{{ $('M`.

## Approach (recommended)

Stack each condition row vertically inside the IF node so `left`, `operator`, and `right` each get the full node width. This avoids forcing every user to widen the node and keeps the IF visually compact when conditions are short.

### `src/components/nodes/layout/RepeaterNodeLayout.tsx`

Update the condition-row container (around line 680):

- Change the grid to a vertical stack: `flex flex-col gap-2 p-2 border rounded bg-muted/10`.
- Put the operator + delete button on their own row so the delete stays inline-right:
  ```
  [ left input              ] (full width)
  [ operator select ] [ x ]  (operator grows, delete fixed)
  [ right input             ] (full width, when shown)
  ```
- Keep all field props as-is — only layout changes.
- Switch (`cases`) repeater uses a different block further down; leave it untouched unless we see the same issue there.

### `src/nodes/If.json`

Bump the node `size.width` from `340` to `380` to give a little extra breathing room for long references and the operator dropdown. Height stays `340`.

## Alternative considered (not chosen)

- Making the IF node user-resizable: bigger change, touches React Flow node wrapper and persistence, and most users won't discover it.
- Only widening the JSON `size.width` without stacking: helps a bit but still truncates long `{{ $('Node').json.path }}` strings.

## Verification

- Drag a long reference into the `left` field of an IF condition — the full expression is visible (with horizontal scroll inside the input if extra long).
- Operator dropdown still opens and selects correctly; delete button remains reachable.
- Adding multiple conditions still renders the AND/OR selector above each extra row.
- Switch (cases) node visual layout unchanged.
- No change to saved condition data shape or execution behavior.
