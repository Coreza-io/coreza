# Architecture rules

- Treat cluster projection nodes as render-only copies; all workflow mutations must start from canonical editor state to prevent hidden display flags leaking into saved/history state.
- Cluster Execute is an editor-local sequence of normal node actions; only explicit Run All uses batch workflow execution.