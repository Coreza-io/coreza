## Trading owner-routing rollout note

- Trading lifecycle events are now routed by `order_owner:*` Redis ownership keys instead of workflow stream fanout keys.
- During rollout, in-flight orders that were placed before ownership mappings existed may not resolve an owner.
- Those no-owner lifecycle events are intentionally dropped from workflow delivery and logged as warnings.
- Expected impact window is short (order lifecycle bounded by 24h TTL).
