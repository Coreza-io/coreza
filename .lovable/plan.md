
# Tool Node System: End-to-End Analysis and Toggle Feasibility

## Part 1: How Tool Nodes Work Today

### 1.1 Frontend: Node Palette and Manifest

The `nodeManifest` in `src/nodes/manifest.ts` loads every `*.json` file in `src/nodes/`. Tool nodes are separate JSON files (e.g., `AlpacaTradeTool.json`, `RSITool.json`) with two key differences from their parent "main" nodes:

| Property | Main Node (e.g., `Alpaca.json`) | Tool Node (e.g., `AlpacaTradeTool.json`) |
|---|---|---|
| `node_type` | `"main"` | `"sub"` |
| `category` | `"Broker"`, `"Indicators"`, etc. | `"Tool"` |
| `handles` | `[{target, left, "input"}, {source, right, "output"}]` | `[{source, top, "tool"}]` |
| `fields` | Full set of operations | Subset (trade-focused, AI-friendly descriptions) |
| `showDescription` | Mostly absent | `false` on most fields (hides in UI, but descriptions still sent to AI) |
| `description` | Short | Detailed, AI-optimized (tells LLM how to use) |

In `NodePalette.tsx`, Tool nodes appear under the "Tool" category alongside main nodes. The palette does not filter by `node_type`.

### 1.2 Frontend: Canvas Behavior

When an AIAgent node is executed (`useNodeExecution.ts` lines 210-250):
1. It finds all edges connected to the AIAgent's `"tool"` handle
2. Filters canvas nodes where `node_type === "sub"` and are connected
3. Serializes those nodes as `support_nodes` with: `id, name, node_type, category, subCategory, provider, values, position`
4. Sends `support_nodes` + `edges` to the backend

The `WorkflowCanvas.tsx` registers all `node_type` values as React Flow node types via `NodeRouter`.

### 1.3 Backend: AI Agent Executor

`AIAgentExecutor.ts` in `coreza-backend/src/nodes/executors/`:

1. **Tool Discovery** (`createToolsFromEdges`): Finds edges targeting the AIAgent's `"tool"` handle, gets the source nodes
2. **Tool Creation** (`createToolFromNode`): For each tool node:
   - Strips "Tool" suffix from name (e.g., `AlpacaTradeTool` -> `AlpacaTrade`)
   - Looks up `TOOL_DEFINITIONS` for description/category fallback
   - Builds Zod schema from node `fields` (or loads from JSON definition via `loadNodeDefinition`)
   - Maps to the correct executor category via `executorCategoryMap` (e.g., `AlpacaTrade` -> `"Broker"`)
   - Creates a `DynamicStructuredTool` that calls the real executor
3. **Execution**: The normalized node (without "Tool" suffix) is passed to the same executor used by main nodes

### 1.4 Backend: Node Definition Loading

`nodeDefinitions.ts` reads JSON files from `src/nodes/` on disk. When resolving schemas, it tries `{name}Tool.json` first, then `{name}.json`. This is the fallback when workflow nodes arrive without `fields`.

### 1.5 Key Insight: Tool Nodes Are Thin Wrappers

The backend already strips "Tool" suffix and routes to the same executor. The actual execution path is identical. The differences are:
- **Handle topology**: Tool nodes only have a `{source, top, "tool"}` handle (connects upward to AIAgent)
- **Field subset**: Tool nodes often have fewer operations (e.g., AlpacaTradeTool only has `place_order`/`cancel_order`, while Alpaca has 12 operations)
- **AI-optimized descriptions**: Tool fields have `description` explaining usage to LLMs
- **`showDescription: false`**: Hides verbose AI descriptions from the UI

---

## Part 2: Feasibility Assessment

### Is a toggle approach feasible? YES, with caveats.

**What works well:**
- Backend already normalizes tool names (strips "Tool") and uses the same executors
- Schema generation from fields is dynamic -- any field set works
- The handle difference is a pure frontend concern (which handles to render)

**Caveats that need design decisions:**

1. **Field subsetting**: Some Tool variants intentionally expose fewer operations (AlpacaTradeTool has 2 ops vs Alpaca's 12). When toggling to tool mode, should the node keep all fields or restrict them?
   - **Recommendation**: Keep all fields. The AI agent will only use what's relevant based on the field descriptions. This is simpler and more flexible.

2. **AI-optimized descriptions**: Tool JSONs have detailed `description` fields on each field telling the LLM how to use parameters. Main nodes lack these.
   - **Solution**: Use a single generic `description` on each field that serves both the UI and the AI agent. No separate tool-specific descriptions needed -- one good description works for both humans and LLMs.

3. **Handle topology**: Main nodes have `{target, left} + {source, right}`. Tool nodes have `{source, top, "tool"}`. In tool mode, the node needs only the top `"tool"` handle.
   - **Solution**: Dynamically swap handles based on toggle state. When `isTool=true`, render only `{source, top, "tool"}`.

4. **Duplicate JSON elimination**: ~20 `*Tool.json` files can be deleted. Their field descriptions need to be merged into the parent JSON files.

---

## Part 3: Implementation Plan

### Step 1: Enrich main node JSON field descriptions

Instead of adding a separate `toolConfig` section, simply add/improve the `description` field on each field in the main node JSONs. These descriptions serve double duty -- they help users in the UI *and* they get sent to the AI agent as part of the Zod schema.

For example, `Alpaca.json` fields currently have no descriptions:
```json
{ "key": "symbol", "label": "Stock Symbol", "type": "text", "placeholder": "e.g. AAPL" }
```

Updated with a generic description:
```json
{ "key": "symbol", "label": "Stock Symbol", "type": "text", "placeholder": "e.g. AAPL", "description": "Stock ticker symbol (e.g. AAPL, MSFT, TSLA)" }
```

This is done for all main nodes that have a Tool counterpart (~15 nodes). The descriptions are merged from the existing `*Tool.json` files but written to be useful for both humans and AI -- no "Tool"-specific jargon.

Nodes that already have good descriptions (like `VWAP.json` session_type) keep them as-is.

### Step 2: Add `isTool` toggle to node instance data (frontend)

In the workflow canvas, each node instance (React Flow node) gets a new boolean in `data.values`:
- `__isTool: boolean` (defaults to `false`)

The toggle button in the node footer flips this value.

### Step 3: Dynamic handle rendering in BaseNode

When `__isTool === true`:
- Hide left/right handles (`input`/`output`)
- Show only `{source, top, "tool"}` handle
- Change node border/badge to indicate tool mode

### Step 4: Update AIAgent tool discovery (frontend)

In `useNodeExecution.ts`, change the `support_nodes` filter from:
```ts
(n.data?.definition as any)?.node_type === "sub"
```
to:
```ts
(n.data?.definition as any)?.node_type === "sub" || n.data?.values?.__isTool === true
```

### Step 5: Update AIAgent executor (backend)

In `AIAgentExecutor.ts`:
- `getToolSchema`: When node arrives with `__isTool` flag and has fields, use field descriptions directly for schema generation (already works since `generateSchemaFromNode` reads `field.description`)
- `getExecutorCategory`: Already works via `executorCategoryMap` with normalized names, no change needed
- `createToolFromNode`: The "Tool" suffix stripping still works; toggled nodes won't have the suffix so this path is cleaner

### Step 6: Update `nodeDefinitions.ts` (backend)

The `loadNodeDefinition` function already falls back to the base JSON. No changes needed since toggled nodes will have the base name (e.g., "Alpaca" not "AlpacaTradeTool").

### Step 7: Delete `*Tool.json` files

After merging descriptions into parent JSONs (Step 1), delete ~20 `*Tool.json` files.

### Step 8: Update NodePalette

Remove the "Tool" category from the palette since tools are now just toggled main nodes. The palette becomes simpler.

### Step 9: Update node schema

No `toolConfig` needed. Just ensure `description` is already supported on `FieldSchema` (it is -- line 136 of `nodeSchema.ts`).

### Step 10: Migration for existing workflows

Existing workflows with `*Tool` nodes need migration:
- On workflow load, detect nodes with `node_type: "sub"` and `category: "Tool"`
- Replace with the base node definition + `__isTool: true`
- Preserve field values and connections

---

## Files Changed

| File | Change |
|---|---|
| `src/nodes/*.json` (main nodes, ~15) | Add/improve `description` on fields |
| `src/nodes/*Tool.json` (~20 files) | **Delete** after merging descriptions |
| `src/components/nodes/BaseNode.tsx` | Toggle button + dynamic handles |
| `src/hooks/useNodeExecution.ts` | Update `support_nodes` filter for `__isTool` |
| `src/hooks/useNodeFieldState.ts` | Serialize `__isTool` flag |
| `src/hooks/useWorkflowPersistence.ts` | Include `__isTool` in save |
| `src/components/workflow/NodePalette.tsx` | Remove Tool category |
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | Handle `__isTool` flag in schema/description resolution |
| `coreza-backend/src/nodes/nodeDefinitions.ts` | No change needed |
| `src/utils/workflowExecutor.ts` | Handle toggled nodes in execution graph |

### Estimated scope: Medium-large refactor across ~25 files
