# Fix: IF node left/right fields too narrow

## Problem

The IF node is fixed at `width: 340` in `src/nodes/If.json`. Each condition row packs `left`, `operator`, `right`, and a delete button into a single grid row, leaving only ~80 px for `left` and `right`. Long dragged-in references like `{{ $('Market Status').json.market_type }}` get truncated to a few characters.

## Approach

Just widen the IF node so the existing row layout has enough room for the left/right inputs. No layout/component changes.

### `src/nodes/If.json`

- Change `size.width` from `340` to `520`.
- Leave `size.height` at `340`.

That's the only change.

## Verification

- Open the IF node — node is visibly wider.
- Drag a long reference into `left` and `right` — the expression is readable without horizontal scrolling for typical values.
- Operator dropdown, AND/OR selector, delete button, and Execute button still render correctly.
- Saved condition data and execution behavior unchanged.
