

# Plan: Workflow Download/Export (like n8n)

## Overview

Add a "Download" button to the WorkflowHeader that exports the current workflow as a `.json` file, similar to n8n's workflow export. The exported file will contain all workflow metadata, nodes, and edges in a portable format that can later be imported.

## Export Format

The exported JSON will follow a structure inspired by n8n:

```json
{
  "meta": {
    "exportedAt": "2026-03-05T...",
    "version": "1.0",
    "source": "coreza"
  },
  "name": "My Workflow",
  "nodes": [
    {
      "id": "get_candle",
      "type": "get_candle",
      "category": "Market Data",
      "subCategory": "Binance",
      "position": { "x": 100, "y": 200 },
      "values": { "symbol": "BTCUSDT", "interval": "1m" },
      "displayName": "Get BTC Candles"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "get_candle",
      "target": "sma",
      "sourceHandle": "output_0",
      "targetHandle": "input_0"
    }
  ],
  "isActive": false
}
```

This reuses the exact same `minimalNodes` format already used in `saveWorkflow` (lines 177-187 of `useWorkflowState.ts`), ensuring consistency.

## Changes

### 1. New utility: `src/utils/workflowExport.ts`

A small helper with two functions:

- **`exportWorkflow(name, nodes, edges, isActive)`** — Builds the export object, strips runtime data (definitions, execution state), serializes to JSON, triggers a browser download as `{workflow-name}.json`
- Uses the same `minimalNodes` cleaning logic from `saveWorkflow` to ensure only portable data is included (no node definitions, no execution results)

### 2. Update `WorkflowHeader.tsx`

- Add a `Download` icon button (from lucide-react) next to the Save button
- Wire it to call `onDownload` prop
- Add `onDownload` to `WorkflowHeaderProps`

### 3. Update `WorkflowEditor.tsx`

- Import the export utility
- Create `handleDownload` callback that calls `exportWorkflow` with current nodes/edges/name
- Pass it as `onDownload` to `WorkflowHeader`

## File Summary

| File | Change |
|---|---|
| `src/utils/workflowExport.ts` | **New** — `exportWorkflow()` utility |
| `src/components/workflow/WorkflowHeader.tsx` | Add Download button + `onDownload` prop |
| `src/pages/WorkflowEditor.tsx` | Wire `handleDownload` → `WorkflowHeader` |

Three files, minimal scope. Import functionality can be added as a follow-up.

