# Manual Agent activity

This delivers the plan's first manual visibility milestone. Single-node Agent
actions, editor Execute All, Loops and cluster Execute retain their existing JSON
execution and normal node actions. The backend instruments Agent, model, memory
and canonical tool boundaries. Activity contains IDs, lifecycle states and durations;
it never contains prompts, memory text, tool arguments/results or credentials.

## Deployment and rollback

Scopes, replay and cancellation are process-local in this release. Route HTTP and
WebSocket traffic to the same gateway process for live highlights. Separate
workers/gateways fall back to the final HTTP result; cross-worker relay, durable
history and live workflow observation belong to the next phase.

`AGENT_ACTIVITY_ENABLED=false` disables registration/production;
`VITE_AGENT_ACTIVITY_ENABLED=false` disables editor subscriptions. Ownership,
namespace and cancellation fixes remain active independently of visibility.
LOG_LEVEL=debug enables setup diagnostics.

A server-generated scope is bound to the authenticated user, editor session,
Agent ID, client invocation and captured attachment revision. It grants access
only to that submitted manual action, including drafts, never to stored workflow
runs by a caller's workflowId. Subscribe, snapshot and cancellation each check
scope ownership. Expired/missing telemetry cannot fail a normal Agent request.
Already-used or mismatched scopes are rejected; execution requests are not retried.

## Bounds and failure semantics

- Up to 64 retained scopes per process, 16 per user, two subscribers per scope.
  Completed traces are evicted first. Unstarted/completed traces expire in five
  minutes; active manual actions have a ten-minute cancellation deadline.
- Events are capped at 1 KB, 256 retained and 256 pending per invocation. Model/
  tool spans have fresh IDs; summaries retain 64 recent and up to 128 active spans.
  Overflow marks missing detail independently of workflow success.
- Socket delivery batches every 20 ms, with terminal flush on the next event-loop
  turn. Slow sockets above 256 KB buffered output are disconnected. HTTP completion
  reconciles missing terminal pushes. Transport loss displays incomplete activity.
- The editor retains up to 64 invocation records, updates only participant/edge
  subscribers and disposes records on workflow switches. Activity never changes
  canonical data, saved graphs, undo history or ordinary final output.
- Cancellation reaches LangChain and adapters receiving the existing abort signal.
  An adapter may already have performed external work; cancellation does not undo
  it. Live market-event and ACK ordering are unchanged.

SimpleMemory deliberately starts a v2 namespace by user, workflow/draft, memory
node and conversation. Old unscoped in-process conversations are not imported.
Sessions expire after 30 idle minutes, with 512 sessions, a 2 MB/session and
32 MB/process serialized-message cap. Oversized writes fail explicitly.
Conversation read/invoke/write ordering is serialized within this process, with
128 active conversation queues and 16 invocations per queue. Redis/database storage
formats, namespace and queries are unchanged; cross-worker locking and shared-table
isolation require the separate storage review in the plan.

Deferred: live watch/worker relay, durable trace export, provider/Agent-definition
caches, database/Redis history optimizations, schema policy changes and tool
parallelism. No performance gain is asserted without measurement.

Validation: source/diff review only; no tests, builds, benchmarks, provider calls
or broker actions were run, as requested.
