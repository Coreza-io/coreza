

# Template Pre-Compilation: Detailed Implementation Plan

## Problem

Every time a node executes, `resolveNodeParameters` calls `resolveDeep` which calls `resolveReferences()` for each template string. Inside `resolveReferences()`:

1. A complex regex (`templateRegex`) is **compiled fresh every call** — millions of times per backtest
2. `pickJsonSource()` probes 10 candidate paths to find data
3. `parsePath()` runs another regex to split `"data.currentValue"` into keys
4. `getValueByPath()` walks the parsed keys

All of this is **identical work every bar** — the template strings in `node.values` never change. Only the data they reference changes.

## Solution: Pre-compile templates once at workflow load time

Instead of parsing `"{{ Recent_High.data.currentValue }}"` with regex on every bar, we parse it **once** into a compiled accessor function that directly reads `allNodeData["Recent_High"].data.currentValue`.

## Architecture

```text
Workflow Load (once)                    Per-bar Execution (136K times)
─────────────────────                   ──────────────────────────────
node.values = {                         allNodeData = store.getAllResults()
  value: "{{ Recent_High.data.cv }}"    
  operator: "subtract"                  resolvedParams = {
  arg1: "{{ Close.data.cv }}"             value: compiledAccessors[0](allNodeData, input),
}                                         operator: "subtract",  // static, no accessor
                                          arg1: compiledAccessors[1](allNodeData, input),
     │                                  }
     ▼                                  
preCompileTemplates(node)               No regex. No parsePath. No pickJsonSource.
     │                                  Just direct property access.
     ▼
CompiledParam[] = [
  { key: "value",  accessor: (data,inp) => data["Recent_High"]?.data?.cv },
  { key: "operator", static: "subtract" },
  { key: "arg1",  accessor: (data,inp) => data["Close"]?.data?.cv },
]
```

## Files to Change

### 1. New file: `coreza-backend/src/utils/templateCompiler.ts`

Core compilation logic:

- **`compileTemplate(templateStr)`** — Parses a single `"{{ $json.x.y }}"` or `"{{ $('Node').json.x.y }}"` string. Returns an accessor function `(allNodeData, input) => value`.
  - Uses the same regex as `resolveReferences` but runs it **once** at compile time
  - For each match, resolves the node key and builds a chain of property accesses
  - For mixed strings (e.g., `"prefix_{{ X.data.id }}_suffix"`), returns a function that concatenates static parts with dynamic lookups
  - For pure template strings (single `{{ }}` with no surrounding text), returns a function that preserves the original type (number, object, etc.) instead of stringifying

- **`compileNodeParams(node, nodes)`** — Walks `node.values` recursively (same shape as `resolveDeep`). For each leaf string containing `{{`, calls `compileTemplate`. Returns a `CompiledNodeParams` object:
  ```ts
  interface CompiledNodeParams {
    hasTemplates: boolean;
    // For nodes with no templates: just return the static values
    staticParams?: Record<string, any>;
    // For nodes with templates: a function that resolves all params in one call
    resolve?: (allNodeData: Record<string, any>, input: any) => Record<string, any>;
  }
  ```

- **Node name resolution** — At compile time, we resolve display names to node IDs (same logic as `resolveNodeKey`) so that at runtime there's zero lookup cost.

- **`pickJsonSource` flattening** — At compile time, we can't know the shape of `allNodeData[nodeId]`, but we can generate an accessor that tries the most common path first (`d.data`) with a fallback chain, or we detect the shape on first execution and cache the winning path.

### 2. Modify: `coreza-backend/src/services/workflowEngine.ts`

- **Add a `_compiledParams` Map** — `Map<string, CompiledNodeParams>` populated once during constructor (or lazily on first access per node).

- **Add `preCompileAllNodes()` private method** — Called from constructor after `this.nodes` is set. Iterates all nodes, calls `compileNodeParams()`, stores results in `_compiledParams`.

- **Modify `resolveNodeParameters()`** — New fast path:
  ```ts
  private resolveNodeParameters(node: WorkflowNode, input: any): any {
    const compiled = this._compiledParams.get(node.id);
    if (compiled) {
      if (!compiled.hasTemplates) return compiled.staticParams;
      return compiled.resolve!(this.store.getAllResults(), input);
    }
    // Fallback to existing resolveDeep logic for safety
    // ... existing code unchanged ...
  }
  ```

- **`_nodeHasTemplatesCache`** — Becomes redundant (subsumed by `compiled.hasTemplates`), but keep for backward compatibility initially.

- **`reset()` / `resetLight()`** — No changes needed. The compiled accessors reference node IDs which are stable. The data they read from (`allNodeData`) is rebuilt each bar from the new store. The compilation is tied to the workflow structure, not the run.

### 3. Modify: `coreza-backend/src/utils/resolveReferences.ts`

- **Hoist `templateRegex`** to module scope — even before full pre-compilation lands, this is a standalone quick win that eliminates regex recompilation for any remaining fallback calls.

## What stays the same

- All executor code (`context.resolveNodeParameters(node, input)`) — unchanged, same signature, same return shape
- `resolveReferences()` function — kept as fallback for edge cases (dynamic templates, nested loops with `$parentStore`)
- `resolveDeep()` — kept as fallback, used by the compiled fallback path

## Edge cases handled

| Case | Handling |
|---|---|
| Mixed strings: `"Buy {{ qty }} shares of {{ sym }}"` | Compile to concatenation function |
| Nested objects/arrays in `node.values` | Recursive compilation mirrors `resolveDeep` structure |
| `$json` (input reference, not cross-node) | Accessor reads from `input` arg instead of `allNodeData` |
| `$('Node').json` and `$node["Node"].json` | Both resolved at compile time to node ID |
| Loop templates (`$parentStore`) | Fall back to runtime `resolveReferences` (detected at compile time) |
| `credential_id` key | Skipped during compilation, same as current code |

## Performance impact estimate

| Metric | Before | After |
|---|---|---|
| Regex compilations per backtest | ~2.86M | ~50 (once per node param) |
| `parsePath` calls per backtest | ~2.86M | ~50 |
| `pickJsonSource` probes per backtest | ~28.6M | 0 (direct access) |
| Object allocations in `resolveDeep` | ~952K | 0 (compiled function returns direct object) |
| **Estimated time saved** | — | **~30-40s** on 136K bar run |

