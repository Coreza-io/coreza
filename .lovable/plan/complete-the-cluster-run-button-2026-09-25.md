# Complete the cluster run button

## Audit verdict

The plan is **partially implemented**.

Implemented and verified:

- The expanded cluster frame has a persistent **Execute cluster** control with preparing, queued, running, cancelling, completed, cancelled, failed, and blocked states.
- The compact cluster component uses the same control and actions, although compact mode is currently disabled by the cluster capability flag.
- Save-before-run, saved revision submission, canonical cluster IDs, run polling, and the run-specific Stop endpoint are wired.
- The backend derives membership from the saved cluster, restricts executable node IDs, bypasses the unsafe shared engine cache, hashes the plan, supports canonical falsy pinned values, and rejects parallel Loop clusters.
- The live database has all required cluster-run columns, validation trigger, idempotency/active-run/cancellation indexes, authenticated read access, service-role write access, and ownership RLS.
- The focused planner suite passes, frontend typechecking passes, and the preview build is healthy.

Still incomplete or incorrect:

- The browser sends neither `boundary_inputs` nor `reference_snapshots`, so clusters with incoming edges or external expression references cannot run correctly.
- Entry packets are merged and `primeEntry` marks every incoming internal edge as satisfied; sequential `Loop → Body → Loop` has no valid activation and is rejected.
- Join readiness still uses branch-group `some(...)`, so selected branches with multiple required paths may run early.
- Boundary outputs are synthesized for every outgoing edge from the final node result instead of recording the handle that actually routed.
- Stop records cancellation intent, but immediately marks the run cancelled after a best-effort queue scan; workers and descendants do not reconcile durable cancellation intent or acknowledgement.
- Reload/navigation does not reattach the button to an active cluster run, retries do not retain one idempotency key, and polling lacks a post-response stale-session guard.
- The editor lock blocks whole-workflow and direct-node execution, but does not block structural edits during a cluster run.
- Cluster runs save scoped nodes/edges beside every workflow cluster, which can leave dangling cluster membership in history.
- Per-member outcomes are not persisted; `branch_skipped`, `dependency_blocked`, and `attachment_only` exist only as declared names.
- Compact button code exists but cannot be exercised while compact mode remains disabled.
- Automated coverage is planner-only; runtime, coordinator, cancellation, migration-upgrade, and signed-in browser acceptance are missing.
- The backend release typecheck currently stops at incompatible TypeScript path configuration, so the production release gate has not passed.

## Implementation plan

### 1. Complete request preparation

- Build `boundary_inputs` from the saved cluster’s canonical incoming edge IDs and current pinned/editor outputs.
- Resolve external expression references into approved `reference_snapshots` without adding external nodes to executable membership.
- Report precise blocked reasons for missing boundary values, unresolved references, invalid credentials, or unsupported members.
- Create one idempotency key per submission attempt and reuse it for retries until a run is created or the saved plan changes.

### 2. Correct entry activation and dependency readiness

- Preserve boundary packets by edge ID and target handle through the runtime instead of collapsing them into one undifferentiated input.
- Seed only the supplied boundary edge; never mark unrelated internal incoming edges satisfied.
- Activate every internal root and explicitly activate the Loop in supported sequential `Loop → Body → Loop` clusters.
- Replace branch-group `some(...)` readiness with activation-aware tracking for selected handles, independent inputs, and loop iteration identity.
- Produce explicit `branch_skipped` and `dependency_blocked` outcomes for members that cannot execute.

### 3. Make outputs and pins truthful

- Keep the canonical `pinnedOutput` reader and remove the legacy planner fallback once persisted compatibility is confirmed.
- Verify pinned action nodes bypass their executors and route falsy values unchanged.
- Record boundary output only when its exact source handle routes; include edge ID, source handle, value, and iteration identity.
- Do not emit untaken conditional handles or inactive Loop exits.

### 4. Finish durable Stop behavior

- Keep `cancelling` after persisting `cancel_requested_at`; do not immediately claim terminal cancellation.
- Make root workers, loop children, aggregators, and continuations check durable cancellation before starting, spawning descendants, and writing success.
- Cancel all jobs sharing `rootRunId`, then set `cancel_acknowledged_at` and `cancelled` only after no eligible descendant remains.
- Guard worker transitions so a late worker cannot overwrite `cancelling` or `cancelled` with `running`, `success`, or `failed`.
- Keep Stop idempotent and retain the active run in the button while reconciliation continues.

### 5. Complete run history and recovery

- Persist a coherent self-contained scoped snapshot: scoped nodes/edges plus only the selected cluster metadata and boundary/reference provenance.
- Persist one terminal member outcome for every scoped member, including pinned, skipped, blocked, attachment-only, failed, and cancelled members.
- Check a matching idempotent run before returning a saved-revision conflict.
- Extend history types with cluster scope, revision, fingerprint, and cancellation fields.
- On editor load, find the latest queued/running/cancelling run for each cluster and reattach polling to its run ID.

### 6. Harden the shared button coordinator

- Add post-response workflow-session, cluster-ID, and run-ID guards to polling as well as execute and cancel.
- Use one editor execution lock for cluster runs, whole-workflow runs, node runs, cluster membership changes, deletes, imports, and graph edits.
- Derive blocked state from current conditions so correcting a problem immediately enables execution.
- Preserve one canonical state and run ID while switching compact/expanded views; do not submit again.
- Keep the compact control implemented but do not enable compact mode as part of this work.

### 7. Add release-level verification

- Add planner/runtime tests for boundary packets, multiple roots, sequential Loop entry, rejected parallel Loop, branch joins, pins, exact routed outputs, and forbidden external-node execution.
- Add service/repository/worker tests for matching and conflicting idempotency, revision races, durable cancellation, descendants, terminal guards, history snapshots, and member outcomes.
- Add frontend tests for single submission, retry key reuse, blocked-state recovery, stale responses, Stop failures, reload reattachment, and event propagation.
- Add signed-in browser acceptance for the visible expanded button, one save plus one scoped request, incoming values, pins, branches, sequential Loop, Stop, navigation/reload recovery, and no whole-workflow fallback.
- Correct the backend TypeScript configuration for the installed compiler, then pass frontend/backend typechecks, focused tests, database assertions, and the production backend image build.

## Completion criteria

The cluster run button is complete when it executes the saved selected cluster with correct boundary values, references, pins, branches, and supported loops; reports durable member and run outcomes; safely stops the root and descendants; survives reload; prevents conflicting edits/executions; and passes automated, database, browser, and release checks.
