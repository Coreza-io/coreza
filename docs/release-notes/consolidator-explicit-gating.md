# Consolidator downstream routing change

## Breaking change

Successful Consolidator executions now always propagate to downstream nodes. This includes held buckets, whose output contains `emitted: false` and `workingBar`. Completed buckets continue to contain `emitted: true`, `bar`, and `workingBar`.

Workflows that should run completed-bar-only logic must insert an **If** node immediately after the Consolidator and connect that logic to the If node's true output. Configure the condition as `emitted == true`.

Existing workflows are not modified automatically. Without an explicit If gate, nodes connected directly to a Consolidator now execute for every source bar.
