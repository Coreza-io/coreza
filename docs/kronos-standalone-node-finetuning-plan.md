# Kronos standalone node + fine-tuning implementation plan

Status: proposed; **not implemented**. Target branch: `dev`. Date: 2026-11-05.

## Objective

Add a native **Kronos Forecast** node to Coreza that supports manual, backtest, execute-all and live workflows. Reuse one persistent, isolated Python/PyTorch inference service. Support fine-tuning through an **asynchronous training job** and selectable model versions, without blocking the workflow runner or altering current broker/portfolio logic.

Reference: https://github.com/shiyu-coder/Kronos (MIT). The public Kronos-small and Kronos-base have a 512-bar maximum context; mini has 2048; model/tokenizer pairs must match. Kronos uses OHLC, with volume and amount optional. Forecasts are **unvalidated estimates**, not trading probabilities.

## Relevant Coreza integration points verified

- `src/nodes/manifest.ts` automatically discovers `src/nodes/*.json`.
- `coreza-backend/src/nodes/index.ts` explicitly registers executors.
- `coreza-backend/src/nodes/registry.ts` stores executors by category.
- `coreza-backend/src/nodes/categoryMap.ts` maps node names to execution categories.
- `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` illustrates parameter resolution and execution-state handling.
- `src/nodes/Visualize.json` accepts candle data; reuse its candle chart presentation where feasible.
- Keep training off the low-latency market-stream, workflow and broker submission services.

## Product UX: one node for forecasting, separate fine-tune management

**Kronos Forecast node**:
- Inputs: `candle_data` (reference to a normalized chronological sequence), `symbol`, `timeframe`, `modelVersion`, `lookback` (default 400), `predLen` (default 12), `sampleCount` (default 1), `temperature` (default 1.0), `topP` (default 0.9), `seed` (optional), `timeoutMs` (bounded).
- Two standard graph handles, left input and right output; no automatic order placement.
- Display: selected model, latest source candle, horizon, predicted move and first/last forecast, with optional future-candle overlay.
- Outputs: `symbol`, `timeframe`, `modelId`, `modelVersion`, `sourceEndTime`, `generatedAt`, `forecastStartTime`, `forecastEndTime`, `predictedCandles[]`, `predictedClose`, `predictedMovePct`, `scenarioSummary`, `latencyMs`, `warnings[]`.
- Explicitly label sampled-path fractions as model scenario fractions, *not calibrated market probabilities*.
- The node can select a fine-tuned model from authorized, ready model versions; do not include a `train` operation inside ordinary node execution.

**Fine-tune management**, reachable from node settings:
- `Fine-tune model` opens job configuration (dataset, base model+tokenizer, timeframe/asset universe, training range, validation range, held-out test range, hyperparameters, resource budget).
- `Start training` creates a job and returns a job ID; progress, metrics, logs and cancellation are displayed separately.
- `Promote model` only after a completed training job and evaluation; retain prior model for rollback.
- Access checks: users see only their own jobs/models, unless intentionally shared through existing authorization.

## Backend implementation

### Phase A — inference MVP

1. Add `src/nodes/Kronos.json` using existing JSON schema; category `Kronos`.
2. Add `KronosExecutor`, register in `coreza-backend/src/nodes/index.ts`, and add `Kronos: 'Kronos'` category mapping when needed.
3. Resolve workflow expressions using the existing parameter resolver. Normalize/validate exact OHLCV shape, timestamps, ordering, finite positive prices, high >= max(open, close, low), low <= min(open, close), timeframe consistency and no incomplete bars. Avoid silently sourcing future data.
4. Create a small typed `KronosInferenceClient` with bounded HTTP timeout, request IDs, structured errors, auth between services and strict response validation. The executor returns the standard Coreza node result envelope. No changes to core broker/portfolio logic.
5. Add a separately deployable Python 3.10+ HTTP service with model/tokenizer loaded once at startup, explicit device selection (CPU/CUDA/MPS as supported), `/health`, `/models`, and `/predict`. Install pinned compatible PyTorch/model dependencies and use published MIT source/models subject to each weight's license.
6. Limit lookback by the chosen model's context; validate horizon, `sampleCount`, symbols, maximum payload size, concurrency and memory. Preload only configured models; no arbitrary client-supplied filesystem paths or Hugging Face repo identifiers.
7. Per completed candle, derive a cache key from user scope, model version, symbol, timeframe, sourceEndTime, horizon and sampling settings. **Do not run inference every live tick**. Never return forecasts from a different model version or candle cutoff.
8. Persist concise run metadata and outputs using existing Coreza node-result mechanics; never serialize PyTorch model weights or massive path arrays through the per-tick Redis transport.

### Phase B — backtest integration

- For every historical invocation, only use bars whose **close timestamp** is no later than the simulated execution time. Calculate forecast target timestamps from the backtest market calendar/timeframe, not from future candle values.
- Do not pass the actual future bars or ex-post labels into model preprocessing. Ensure training data/model checkpoints predate the evaluation window, including model-version metadata.
- Record model checksum, tokenizer checksum, version, inference parameters, random seed and historical cutoff for reproducibility.
- Evaluate chronologically with a walk-forward, genuinely held-out period; compare against baseline persistence, EMA, and simple return models, plus strategy-level after-cost PnL and drawdown.
- If inference cannot meet the backtest throughput budget, prefer offline precomputed, timestamp-keyed forecasts with provenance; **never** accidentally treat forecasts as market-fill prices.
- Distinguish forecasting error from trading return; a good candle forecast does not guarantee alpha.

### Phase C — fine-tuning (async, opt-in)

1. Introduce DB metadata tables (or existing compatible job records) for `kronos_training_jobs` and `kronos_model_versions`: owner, base model/tokenizer, data/time ranges, timeframe, immutable dataset checksum, status, metrics, artifact reference, timestamps, hardware budget and error summary. Reuse Supabase RLS policies and existing auth, without exposing secrets.
2. Add `POST /kronos/training-jobs`, `GET /kronos/training-jobs/:id`, `POST /kronos/training-jobs/:id/cancel`, `GET /kronos/models`, and guarded `POST /kronos/models/:id/promote` in existing route conventions.
3. Use an isolated training worker/queue and model artifact storage, **not** the live workflow/BullMQ trading queue. Bound GPU/CPU/memory/disk and number of concurrent jobs per user. Set retention/cleanup for stale runs.
4. Validate data provenance, duplicates, adjusted/unadjusted prices, corporate actions, symbol mapping, timeframe gaps, holidays, session boundaries and time zone. Split strictly by time with an embargo if overlapping context/targets could leak. Never fine-tune on evaluation/test periods.
5. Initially use the upstream Kronos training pipeline for tokenizer/model fine-tuning; pin versions and evaluate resource requirements before offering multi-GPU or full fine-tuning in the UI. Consider parameter-efficient alternatives only after compatibility is verified.
6. Store model and tokenizer as a paired, immutable version. Only promote an evaluated artifact; warm it in the inference service, verify health and then atomically switch the preferred version. In-flight requests keep their pinned model version.
7. Provide training logs, progress, validation/test metrics, benchmark-vs-base comparison, failure reasons and an explicit rollback action. Do not let agent prompts or a normal node invocation trigger paid training resources.

## Execution policies

- Manual/execute-all: infer on demand using supplied closed bars; errors surfaced in node output.
- Backtest: synchronous-from-runner API call may await a bounded service response, but no training; enforce as-of timestamp and model snapshot.
- Live: inference only on completed configured candle; use immutable latest forecast or explicit skipped/stale status. Timeout and model unavailability fail closed for forecast-dependent trade logic.
- Training: background **job** with explicit user action; training does not run in streaming/backtest/agent execution loops.
- Cloud/hosted deployment: never download untrusted models at execution time; use allowlisted, administrator-provisioned model artifacts and resource quotas.

## Security and correctness gates

- Authenticate client-to-inference calls; constrain network routing; disable arbitrary command execution, path traversal and user-selected remote code.
- Evaluate model/tokenizer weight provenance and licenses; upstream repository MIT does not necessarily establish each hosted weight's separate terms.
- Versioned dataset and model artifacts; per-user access controls; artifact checksum; training cancellation; back-pressure.
- Prevent look-ahead and cross-user cache leakage; verify consistent timestamps and completion state; enforce bounded array outputs.
- Failure isolation: an inference outage cannot stop broker stream ingestion or corrupt portfolio state.
- Avoid generic `confidence` percentages without empirical calibration. Forward-test before any live order dependence.

## Acceptance criteria

- Node appears in editor, runs using historical OHLCV and returns structured forecasts.
- Manual, execute-all, backtest and live modes handle the node using their normal Coreza result contracts.
- Backtesting is reproducible, uses strict as-of data, and disallows training/evaluation leakage.
- A fine-tuning job can be submitted, monitored and cancelled; completed models are versioned and individually selectable.
- Training cannot run on the live execution path; broker and portfolio code remains unchanged.
- CPU-only deployments can disable the feature cleanly or serve a supported small model; errors are explicit.
- No claims about model trading accuracy until out-of-sample results support them.

## Delivery sequence

1. Build inference service and Kronos standalone node with default pretrained Kronos-small.
2. Add results visualization and historical as-of correctness.
3. Implement fine-tuning job management and model version storage.
4. Validate reliability, security, deployment and real-world inference cost before production enablement.

**Scope decision:** Keep existing AIAgent tool integration out of MVP; it may call the same inference service later. Do not merge incomplete node-only scaffolding into dev before the executor and service are available.
