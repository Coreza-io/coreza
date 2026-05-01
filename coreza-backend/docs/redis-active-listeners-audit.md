# Redis key audit: `md:user:{userId}:stream:active_listeners`

This note traces where the key is created, updated, and effectively cleaned up.

## Key definition

- Defined in `REDIS_CHANNELS.userActiveListeners(userId)` as:
  `md:user:${userId}:stream:active_listeners`

## Where entries are created

- `RegistrationService.createListener(...)`
  - Adds each newly created listener key into the per-user set via:
    `redis.sadd(userListenersKey, listenerKey)`
  - Called after writing the listener payload with TTL.

## Where entries are removed

- `RegistrationService.deleteListener(...)`
  - Removes the listener key from the set via:
    `redis.srem(userListenersKey, listenerKey)`

- `RegistrationService.getActiveListeners(...)`
  - Opportunistic cleanup of stale set members:
    - `srem` if listener JSON is invalid
    - `srem` if listener key no longer exists

- `RegistrationService.cleanupUserListeners(...)`
  - Bulk cleanup path:
    - deletes each listener key and result key
    - `srem` each listener key from the user set

## Important behavior note

- The set key is now explicitly deleted when empty via `deleteActiveListenersSetIfEmpty(...)` after delete/list/read-cleanup flows.
- `cleanupUserListeners(...)` also deletes the listener count key (`md:user:{userId}:stream:listener_count`).

## Related keys

- Listener item key: `md:user:{userId}:stream:{workflowId}:{nodeId}`
- Listener result key: `md:user:{userId}:stream:{workflowId}:{nodeId}:result`
- Listener count key: `md:user:{userId}:stream:listener_count`
