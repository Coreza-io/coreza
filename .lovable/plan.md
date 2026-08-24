# Consolidator completion — minimal, event-only

Replaces the wall-clock Scan plan. No timers, no scheduler, no state discovery, no result injection, no compiled VM changes, no manual scan endpoint. A target bar closes from the timestamp of a completed source bar.

## Behaviour change

Today a 1h→4h consolidator waits for a bar from the next bucket. Instead, derive each input's end (`inputStart + source.milliseconds`) and close the bucket once that end reaches `workingBar.endTimestamp`.

```text
14:00 input ends 15:00 -> keep working
15:00 input ends 16:00 -> aggregate first, then emit 12:00-16:00
```

Accepted limitation: if no source bar arrives, nothing closes. Halts, feed silence and shutdown flushing belong to the later wall-clock feature.

Prerequisite: `Bar.timestamp` means interval start. A provider sending interval-end normalizes in its own adapter, never inside the consolidator.

## Algorithm in `TimeBarConsolidator.update()`

1. normalize fill-forward volume
2. validate duplicate / out-of-order
3. compute the input bucket
4. create or aggregate the working bar
5. `inputEnd = inputStart + sourceMs`
6. emit **after** aggregation when `inputEnd >= workingBar.endTimestamp`
7. otherwise keep the working bar
8. save `lastInput` on both paths

Aggregate first, check completion second — otherwise the emitted bar loses the final source bar's OHLCV and volume.

Boundary-gap precedence is unchanged: an input belonging to a later bucket while an older working bar exists emits the older bar and starts the new one; only one `data.bar` per event, so the freshly started bucket does not also emit.

No `scan(currentTime)` method — that name implies a clock contract this release defers. The future feature can extract the shared close transition later.

## State and payload

- `ConsolidatorState`: `workingBar?` optional, `lastInput` required.
- `ConsolidatorPayload`: `bar` and `workingBar` both nullable.
- `isConsolidatorState()` accepts a closed state (`lastInput` present, no `workingBar`); when `workingBar` exists it must carry usable `timestamp` and `endTimestamp`.
- No `lastEmittedEndTimestamp` watermark yet — `lastInput` covers duplicate/out-of-order for event-only closing.

## Files

| File | Change |
| --- | --- |
| `TimeBarConsolidator.ts` | store `sourceMs`, optional `workingBar`, aggregate-then-close, handle state without a working bar (~40-70 lines) |
| `consolidatorShared.ts` | nullable payload `workingBar`, validator accepts closed state (~15-30 lines) |
| `ConsolidatorExecutor.ts` | type compatibility only |
| tests | completion, transitions, gap and regression cases |

Must not change: `WorkflowRunner.ts`, `workflowRun.ts`/`workflowEngine.ts`, `executionRuntime.ts`, `BacktestSession.ts`, compiled VM, storage route, and the frontend node JSON beyond nullable `workingBar` handling.

## Sequence

1. lock the timestamp-start contract in tests (15:00 1h input derives 16:00)
2. refactor `update()` for optional working state
3. add the post-aggregation completion check
4. update shared validation and payload
5. run all suites — no routing or warm-up regression

## Tests

No early emission on the first in-bucket bar; continuous close emitting after the 15:00 bar with all four bars included; partial initial bucket (14, 15) emitting the 12-16 label; OHLCV correctness (first open, max high, min low, last close, summed volume); fill-forward volume contributes zero; closed state then a 16:00 bar creates the 16-20 bucket; exact duplicate returns `duplicate=true`; `suppressDownstream` still true while held.
