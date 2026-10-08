# Architecture rules

- Treat cluster projection nodes as render-only copies; all workflow mutations must start from canonical editor state to prevent hidden display flags leaking into saved/history state.
- Cluster Execute is an editor-local sequence of normal node actions; only explicit Run All uses batch workflow execution.
- Node identity changes are canonical document transactions that update nodes, edges, cluster membership, references, and runtime keys together; projected React Flow copies are never renamed directly.- Custom edges read only their own endpoints via React Flow `useStore` selectors, and cluster projections pass through `reconcileClusterProjection`; whole-node-array subscriptions make every edge and card re-render on each drag frame.

- Persisted clusters may contain disconnected members; only cluster creation requires connectivity. The editor and server validators must agree.
- Cluster Execute repeats a Loop's body per iteration through normal node actions and writes Loop feedback the same way Run All does.

- Cluster execution visual effects overlay reconciled displayed graph copies only; never persist execution flags or edge styles into canonical state or committed base projections.
- Required-field and runtime action failures share guarded publication to local output, execution store and canonical node data, followed by one explicit store notification; detailed errors belong in Output Data.

- Allocate instance names through `src/domain/nodeNaming.ts` against canonical IDs and explicit names, including hidden members. New nodes use the same ID and displayName; labels fall back to the committed ID, never array order. Preserve optional top-level displayName in saved node JSON. Manual file import alone creates fresh UUID identities with separately allocated public names.
- Generate dragged selectors from current canonical IDs. Named references resolve exact IDs before unique legacy aliases; ambiguous aliases produce diagnostics. Simultaneously remap supported selectors only in editable values, using aliases proven by the original complete inventory.
