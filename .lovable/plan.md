# Consolidator hardening plan

The findings match the code I read: the state key in `consolidatorShared.ts` has no node id, the `/storage/consolidator` route resolves a context purely by execution id, and `resolveConsolidatorWarmup` takes a max over independent consolidators rather than multiplying ratios along a chain. The compiled-join, fill-forward and InMemoryStore points are consistent with the sources cited and are addressed below (the compiled-join item begins with a confirming read of `vm.ts`/`compiler.ts`).

## 1. Node-scoped state key (High)

- `buildConsolidatorStateKey` takes `nodeId` and returns `consolidator:{nodeId}:{symbol}:{source}:{target}:{timezone}:{anchor}`; `nodeId` is required, so no unscoped key can be built.
- `ConsolidatorExecutor` passes `node.id`; the route reads `node_id` from the body and rejects the request when it is missing.
- `Consolidator.json` sends `node_id` with the manual request.
- Warm-up seeding writes under the same builder so a warmed bucket is found by the node that owns it.

## 2. Route ownership verification (High)

- After resolving the context, verify `dataContext` belongs to `req.user.id` and to the requested workflow; on mismatch return the same 404 as "context not found" (no existence oracle).
- If `DataContext` does not expose owner/workflow today, add read-only accessors populated at creation; do not trust any body-supplied user id.

## 3. Compiled VM join dependencies (High)

- Read `vm.ts` and `compiler.ts` first to confirm activation is any-of.
- If confirmed, give the compiled plan per-node incoming dependency counts/masks matching the dynamic runtime's branch-aware rule (ANY-of within the same branch, ALL-of across independent branches), so a suppressed consolidator edge holds its join instead of letting a stale slot be read.

## 4. Nested consolidator warm-up (Medium)

- Walk consolidator chains and multiply ratios along each path (`1h→4h→1d→SMA(20)` ⇒ `20 × 4 × 6` plus one bucket of cushion per stage) instead of taking the max of independent ratios.
- Keep the single-stage result unchanged.

## 5. Fill-forward volume (Medium)

- Emit fill-forward bars in `WarmupReplay` with `volume: 0` and an explicit `_isFillForward` marker; the consolidator ignores volume on marked bars so a flat period cannot inflate consolidated volume.

## 6. InMemoryStore size accounting (Medium)

- In `set()`, subtract an existing entry's `sizeBytes` before the capacity check and replacement so repeated overwrites of one key stop reporting growth and stop evicting unrelated state.

## Tests

- Two identically configured consolidators on one workflow both emit at their own boundaries.
- Route rejects a foreign execution id and a missing `node_id`.
- Join graph: indicator does not fire on held source bars.
- Chained-ratio warm-up sizing; fill-forward volume neutrality; `InMemoryStore` overwrite keeps size flat.
