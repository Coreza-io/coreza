

# Plan: Upload/Import Workflow from JSON

## Overview

Add an "Upload" button next to the Download button in the WorkflowEditor header. Clicking it opens a file picker for `.json` files. The uploaded file is validated against the `ExportedWorkflow` schema, then its nodes and edges are restored into the canvas — reusing the existing `handleRestoreFromVersion` logic which already handles mapping node types back to manifest definitions.

## Changes

### 1. Update `src/utils/workflowExport.ts` — Add `importWorkflow()` parser

Add a function that:
- Accepts a `File`, reads it as text, parses JSON
- Validates required fields (`meta.source === 'coreza'`, `nodes` array, `edges` array, `name` string)
- Returns the parsed `{ name, nodes, edges, isActive }` or throws a descriptive error

### 2. Update `src/pages/WorkflowEditor.tsx` — Add Upload button + handler

- Import `Upload` icon from lucide-react and `importWorkflow` from the export utility
- Add a hidden `<input type="file" accept=".json">` ref
- Add an Upload icon button next to the Download button that clicks the hidden input
- On file select, call `importWorkflow(file)`, then:
  - Set `workflowName` from the imported data
  - Call `handleRestoreFromVersion(nodes, edges)` to restore nodes with manifest definitions and edges with handlers (this logic already exists and works correctly)
  - Show a success toast

## File Summary

| File | Change |
|---|---|
| `src/utils/workflowExport.ts` | Add `importWorkflow(file): Promise<ExportedWorkflow>` validation/parser |
| `src/pages/WorkflowEditor.tsx` | Add Upload button, hidden file input, `handleImportWorkflow` handler |

Two files, minimal scope. Reuses existing `handleRestoreFromVersion` for node/edge restoration.

