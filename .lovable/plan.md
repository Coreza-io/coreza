

# Add Pause/Resume Toggle to Streaming Nodes

## Current Architecture

The streaming footer in `OutputPanel.tsx` (line 529-548) shows a "Streaming..." indicator with a single **Stop** button. Stream data flows through `ExecutionStoreContext.tsx` which receives WebSocket messages (`market_data`, `test_data_received`) and updates node output when `isTestListening === true`. The **Stop** button calls `/stream/unregister` on the backend, fully tearing down the stream.

## Design

Add a **client-side only** pause mechanism. The stream stays alive on the backend (no API call needed) — we simply gate the UI updates in `ExecutionStoreContext` by checking a new `isStreamPaused` flag. This is the cleanest approach because:

- No backend changes needed — pause is purely a UI concern
- No data loss — the stream continues; we just skip rendering updates
- Resume is instant — flip the flag and the next event renders normally

### UI: Two-button footer

Replace the current single Stop button with a split control:

```text
┌──────────────────────────────────────────┐
│  (•) Streaming...     ⏸ Pause   ■ Stop  │
│  (•) Paused           ▶ Resume  ■ Stop  │
└──────────────────────────────────────────┘
```

- **Pause/Resume** — toggle button, swaps icon (Pause ↔ Play) and label
- **Stop** — existing destructive button, tears down the stream entirely
- When paused, the pulsing dot stops animating and text changes to "Paused"

## Implementation

| File | Change |
|---|---|
| `src/contexts/ExecutionStoreContext.tsx` | Add `isStreamPaused` to node data type. In the `market_data` and `test_data_received` handlers (~lines 121-165), check `existingData?.isStreamPaused !== true` before updating output. If paused, silently skip the update. |
| `src/utils/executionContext.ts` | Add `isStreamPaused?: boolean` to the node data interface (line ~46). |
| `src/components/nodes/BaseNode.tsx` | Add `isStreamPaused` memo (reads from execution store like `isTestListening`). Add `handleTogglePause` callback that flips `isStreamPaused` in the execution store. Expose both in `renderProps`. |
| `src/utils/OutputPanel.tsx` | Accept new props: `isStreamPaused`, `onTogglePause`. Update the streaming footer to show two buttons: Pause/Resume toggle + Stop. Change indicator text/animation based on paused state. |
| `src/components/nodes/NodeRouter.tsx` | Pass `isStreamPaused` and `onTogglePause` through to OutputPanel props. |
| `src/components/workflow/LoopNode.tsx` | Same passthrough for LoopNode's OutputPanel usage. |

No backend changes. No new dependencies.

