# Coreza Roadmap

## Current Focus

- Improve backtesting engine
- Improve Portfolio logic
- Improve broker integration layer
- Improve market data streaming
- Improve AI node/tools
- Add documentation for contributors

## Planned

- More indicator nodes
- More broker integrations
- Strategy templates
- Better chart visualization

## Not Production Ready Yet

Coreza is still early and should not be used for real-money trading without testing, review, and risk controls.

## Nested cluster rollout

- [x] Shared direct/effective hierarchy contract, depth-two validation and scoped plan hashing
- [x] Supported-writer API declaration, capability endpoint and atomic RPC argument
- [ ] Deploy the main repository's `20261009090000_cluster_hierarchy_writer_guard.sql` migration and verify readiness/old-writer refusal against the hosted database
- [ ] Deploy readers/guards before frontend authoring; keep guards/readers when authoring is disabled
