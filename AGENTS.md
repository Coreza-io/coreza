# Architecture rules

- Treat cluster projection nodes as render-only copies; all workflow mutations must start from canonical editor state to prevent hidden display flags leaking into saved/history state.
- Cluster Execute is an editor-local sequence of normal node actions; only explicit Run All uses batch workflow execution.
- Node identity changes are canonical document transactions that update nodes, edges, cluster membership, references, and runtime keys together; projected React Flow copies are never renamed directly.- Custom edges read only their own endpoints via React Flow `useStore` selectors, and cluster projections pass through `reconcileClusterProjection`; whole-node-array subscriptions make every edge and card re-render on each drag frame.
