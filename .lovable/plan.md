# Make BacktestInit credential handling identical inside and outside clusters

## Confirmed cause

- Direct `POST /backtest/init` execution constructs `node.values.credential_id` from the submitted node fields and calls `BacktestExecutor` without the shared parameter resolver.
- Queued workflow and cluster execution call `BacktestExecutor` through `ParameterResolver`.
- `compileNodeParams` and both resolver fallback paths intentionally omit `credential_id`, so cluster execution reaches `BacktestExecutor` with the saved broker settings but without `params.credential_id`.
- `BacktestExecutor` currently reads only `params.credential_id`, causing the reported `credential_id is required for selected broker` failure.
- The current validation happens after the backtest row is inserted and the simulated portfolio is created, leaving unnecessary state when required configuration is invalid.

## Implementation

### 1. Define one trusted credential-reference rule

- Keep `credential_id` excluded from generic template compilation and resolved parameter objects. Do not expose credential references through expression data, node outputs, boundary inputs, or logs.
- Add a small BacktestInit-specific resolver that selects the credential reference in this order:
  1. `params.credential_id` for the existing direct `/backtest/init` path.
  2. `node.values?.credential_id` for saved workflow, whole-workflow, and cluster execution.
  3. `node.data?.values?.credential_id` only as a compatibility fallback for persisted node shapes that still store values there.
- Accept only a non-empty string after trimming. Never accept `credential_id` from upstream workflow input, cluster boundary input, reference snapshots, or client-supplied execution scope data.
- Use the resolved value only as an opaque credential reference; never serialize decrypted credential data into workflow runs, node results, errors, or logs.

### 2. Validate before creating backtest state

- Resolve and validate `broker`, symbols, interval, dates, and the credential reference before inserting a `backtests` row, creating a `SimBroker`, initializing a portfolio, recording start-time state, or creating a backtest session.
- Preserve the existing credential-free behavior for `yahoo_finance`.
- For providers that require credentials, validate the saved reference through the existing user-scoped credential lookup using `context.userId` and the normalized broker/service type.
- Treat a missing, deleted, wrong-provider, inaccessible, or undecryptable credential as a clear BacktestInit validation failure before side effects begin.
- Keep authorization server-side: the authenticated `userId` from execution context must scope the lookup; do not trust any user ID from node values or request input.
- Reuse the validated credential reference for both strategy-history and warm-up-history requests so both fetch paths have identical behavior.

### 3. Preserve execution-path parity

- Route direct node execution, whole-workflow execution, and cluster execution through the same BacktestInit credential-resolution and validation helper.
- Do not add cluster-only credential injection to the planner, queue payload, or execution request. The queued node snapshot already contains the saved node values and remains the authoritative source.
- Keep the cluster planner’s canonical member-node snapshot unchanged so the saved credential reference remains attached to BacktestInit when the cluster subgraph is queued.
- Ensure the cluster plan hash and run snapshot continue to cover the saved node configuration without copying credential references into boundary/reference payloads.
- Return the same success result and the same credential-related error category/message regardless of whether BacktestInit is run directly, in a full workflow, or in a cluster.

### 4. Make failure cleanup defensive

- Reorder initialization so all deterministic configuration and credential checks occur before persistent or in-memory allocation.
- If a later asynchronous initialization step fails after allocation, remove the created session, simulated broker cache entry, and start-time entry, and mark or remove the backtest row according to the existing failed-backtest policy.
- Confirm repeated retries do not reuse a failed broker/session instance or leave duplicate active backtest state.

### 5. Focused automated tests

Add backend tests covering:

- direct BacktestInit execution succeeds when `credential_id` is supplied through direct parameters;
- resolver-backed BacktestInit succeeds when resolved params omit `credential_id` but the saved node contains it;
- the same saved BacktestInit node produces equivalent credential selection in whole-workflow and cluster-scoped execution;
- `node.data.values` compatibility works only when canonical `node.values` is absent;
- direct parameters take precedence over the saved fallback without allowing workflow input or cluster boundary data to override the credential;
- Yahoo Finance succeeds without a credential in every execution path;
- a required credential that is missing, blank, deleted, owned by another user, for the wrong provider, or undecryptable fails before database insertion, broker-cache creation, portfolio initialization, or session creation;
- strategy and warm-up historical requests receive the same validated credential reference;
- `ParameterResolver` and `compileNodeParams` still omit `credential_id` from generic resolved parameters;
- cluster execution still uses the saved revision snapshot and does not add credential data to entry activations, reference snapshots, outputs, or error logs.

### 6. End-to-end acceptance

Using one saved workflow containing BacktestInit with a selected credential:

1. Run BacktestInit individually and confirm initialization succeeds.
2. Run the full workflow and confirm the same credential is used.
3. Run the containing cluster from both expanded and compact views and confirm it reaches the same initialized/running state.
4. Compare the three runs for matching provider, symbols, interval, and historical-data behavior.
5. Remove the credential selection and confirm all credential-required paths fail before a backtest record or simulated portfolio is created.
6. Select Yahoo Finance without credentials and confirm all three paths still work.
7. Confirm logs and persisted run results contain no decrypted secrets or additional credential payloads.

## Completion criteria

- A saved credential works identically for direct, whole-workflow, and cluster BacktestInit execution.
- Generic parameter resolution continues to exclude `credential_id`.
- Credential validation and ownership checks happen before backtest persistence or simulated portfolio creation.
- Invalid credentials leave no active session, cached broker, or partially initialized run state.
- Focused backend tests pass, and no credential values are exposed in logs or execution payloads.
