# Live tick latency

Set `LIVE_TIMING_ENABLED=true` in the API and market-stream service, then restart
both. Metrics use their existing Prometheus scrape endpoints. The default is off;
there are no telemetry network calls or per-tick tracing IDs. One correlation
generation is allocated per gateway, alongside the existing sequence/domain.
Logging continues to use the existing `LOG_LEVEL=debug` startup switch.

## Measurements

All histogram units are seconds. Local elapsed times use `performance.now()`.
The new metric families have sub-millisecond/millisecond buckets and bounded
labels; existing metric names, bucket layouts and cumulative node timing remain
unchanged. Do not interpret existing cumulative node averages as one tick's time.

| Metric | Boundary |
| --- | --- |
| `coreza_live_ingress_seconds` | Gateway handler entry to estimated stream append; aggregated bars start at close eligibility |
| `coreza_live_queue_delay_seconds` | Estimated stream append to execution start, including batch wait and admission/run creation |
| `coreza_live_execution_seconds` | Before reset/preload to engine completion, including awaited indicator flush; excludes outcome write and ACK |
| `coreza_order_submit_http_seconds` | Each broker submission request invocation to response/error; excludes enrichment |
| `coreza_live_runner_cycle_seconds` | Event processing/admission through finalization/ACK or another disposition |
| `coreza_live_receipt_to_decision_seconds` | Gateway receipt (bar eligibility for aggregated bars) to engine completion |
| `coreza_live_receipt_to_submit_seconds` | Gateway receipt (bar eligibility for aggregated bars) to the first submission attempt |
| `coreza_live_signal_to_submit_seconds` | Execution start to the first submission attempt |

`coreza_live_stage_seconds` separates subscriber queue wait, workflow lookup,
XADD round trip, stream read, batch parsing/wait, run creation/admission, node work,
result building, immediate indicator writes, indicator serialization/flush/write,
outcome write and ACK. These stages can overlap/nest; do not sum them or their
percentiles. Stream-read time includes idle blocking and error backoff, so it is
not an engine latency. Runner-cycle time excludes stream reads and batch parsing;
include them when interpreting sustained throughput.

`coreza_order_stage_seconds` reuses the existing fixed TRADE_TIMING phases,
including credentials, idempotency, ownership, broker operation and enrichment.
Its `settled` samples report elapsed phase time even when the operation later
fails. Submission histograms include failed attempts, never fake zero-duration
samples for cached/pending/rejected orders. Broker acceptance is not a fill.
Current order adapters use generic POST/DELETE submission paths; transport
wrapping also covers custom operations and Axios instances created through it.
Within an order operation, mutating HTTP calls in `brokerOperation` are submissions;
read-only calls and the separate enrichment phase are excluded. Audit/tag any
future custom adapter with different request semantics before relying on this
classification. Request sums and operation wall times remain distinct.
HTTP/phase measurements also cover manual orders and child invocations without
runner timing context. Signal/receipt-to-submit requires that context; distributed
children do not automatically share their parent's first-submission observation.

`coreza_live_events_total` exposes delivery, append, runner, outcome-write, ACK
and order dispositions. `coreza_live_ingress_queue_events` counts waiting live
tasks, not promise-chain keys. Use the API's existing default process/event-loop
metrics alongside these distributions. Counters describe observed handling;
they do not prove lossless delivery through Pub/Sub or stream trimming.

## Clock estimates

Cross-clock histograms remain unavailable until an operator sets
`LIVE_TIMING_CLOCKS_VERIFIED=true` after checking gateway/runner epoch clocks and
Redis time outside the event path. Record the uncertainty with the benchmark;
invalidate this setting when clock health changes. No automatic clock-health
verification is implied by the setting. Redis stream-ID time is a millisecond
estimate and can be distorted by rollback/prior future IDs. Never use these
estimates to substantiate improvements smaller than the measured uncertainty.

`coreza_live_clock_samples_total` distinguishes `unverified`, `missing`, `invalid`
and `approximate` samples. Negative/non-finite durations are excluded and counted,
not clamped. Legacy events without metadata still have local execution/cycle
measurements. Provider timestamps are not treated as receipt times or feed age.
Aggregated bars retain gateway provenance and carry a separate close-eligibility
timestamp; their intentional accumulation interval is not raw-tick ingress.

## Scope and rollout

This is the plan's measurement/low-risk first slice. Debug argument construction
is guarded, disabled order diagnostics reuse a no-op observer, and live indicator
and rolling-window keys use activation `executionId`, while per-event `runId`
continues to identify history/orders. Runtime context updates preserve both.

Strategy ordering, manual/backtest state policy, credential TTL/refresh,
stream topology/retention, order intent, outcome recording, ACK and indicator
flush scheduling are unchanged. Existing outcome-write failure handling and
indicator dirty-key clearing after command-level pipeline errors are unchanged;
metrics expose those failures rather than claiming checkpoint coverage.

Before further optimization, compare telemetry off/on with the same revision,
hardware and independent offered load. Record p50/p95/p99, event counts, sustained
completion rate, backlog age, Redis RTT/bytes and CPU/GC. Include warm/cold paths,
multiple workflows, order/non-order events, bursts, background work and cache
expiry windows longer than five minutes. No performance savings are assumed.
Activation definition/credential pinning follows the separate lifecycle plan;
graph storage changes, deferred reporting and background indicator checkpoints
remain gated on measured benefit and their reader/recovery contracts.
