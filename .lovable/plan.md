

# Review: Template Pre-Compilation Implementation

## Verdict: Well-implemented with a few issues to fix

The implementation is solid — correct architecture, good edge case handling, and clean separation. However, there are **4 concrete issues** ranging from a bug to missed optimizations.

---

## Issue 1: Bug — `resolveReferences` returns `full` instead of `null` for missing values

**File:** `coreza-backend/src/utils/resolveReferences.ts` line 204

```ts
// Current (line 204):
if (value === undefined) return full;   // returns the raw "{{ ... }}" string

// But templateCompiler.ts (line 213):
return value === undefined ? null : value;  // returns null
```

This is a **parity mismatch**. The compiled path returns `null` for missing values, but the fallback runtime path returns the raw template string `{{ ... }}`. Downstream code may behave differently depending on which path runs. The test file (`resolveReferences-parity.test.ts` line 72) expects `'null'` for missing paths, which aligns with the compiler but not with the current `resolveReferences.ts`.

**Fix:** Align `resolveReferences.ts` line 204 to return `null` instead of `full` (matching the compiled path and the test expectation), OR change the compiler to match the runtime behavior. The `null` approach is correct — returning raw template strings to downstream math operations causes failures.

---

## Issue 2: `pickJsonSource` still runs per-bar in compiled accessors

**File:** `coreza-backend/src/utils/templateCompiler.ts` lines 178-183

```ts
accessor = (allNodeData, _input) => {
  const nodeData = allNodeData[resolvedId];
  if (nodeData === undefined) return undefined;
  const source = pickJsonSource(nodeData);  // ← runs every bar
  return pathAccessor(source);
};
```

The plan stated: *"detect the shape on first execution and cache the winning path."* Currently `pickJsonSource` probes up to 10 candidates on every bar. For 136K bars × 30 nodes with templates, that's still millions of probes.

**Fix:** Add a one-shot shape cache per accessor. On first call, determine which candidate path works, then lock in a direct accessor for subsequent calls:

```ts
let cachedExtractor: ((d: any) => any) | null = null;
accessor = (allNodeData, _input) => {
  const nodeData = allNodeData[resolvedId];
  if (nodeData === undefined) return undefined;
  if (!cachedExtractor) {
    // Determine shape once, cache the direct path
    if (nodeData.json !== undefined) cachedExtractor = (d) => d.json;
    else if (nodeData.output?.json !== undefined) cachedExtractor = (d) => d.output.json;
    // ... etc, falling back to pickJsonSource
    else cachedExtractor = pickJsonSource;
  }
  return pathAccessor(cachedExtractor(nodeData));
};
```

---

## Issue 3: Mixed-string compiled accessors allocate per-bar

**File:** `coreza-backend/src/utils/templateCompiler.ts` lines 231-250

The mixed-string path (`"Buy {{ qty }} shares"`) builds a result via string concatenation in a loop over `segments`. This is fine and unavoidable for mixed strings. But a minor optimization: for the common case of exactly one dynamic segment with static prefix/suffix, a specialized fast path avoids the loop:

```ts
if (segments.length === 3 && segments[0].type === 'static' && segments[2].type === 'static') {
  const prefix = segments[0].value;
  const suffix = segments[2].value;
  const acc = segments[1].accessor;
  return (allNodeData, input) => prefix + String(acc(allNodeData, input)) + suffix;
}
```

This is a minor optimization — only pursue if profiling shows mixed strings are common.

---

## Issue 4: `_hasFallbackEntries` re-scans resolved values

**File:** `coreza-backend/src/services/workflowEngine.ts` lines 347-353

```ts
if ((compiled as any)._hasFallbackEntries) {
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string" && value.includes("{{")) {
      resolved[key] = this.resolveDeep(value, input, allNodeData);
    }
  }
}
```

This iterates **all** entries to find the fallback ones. Since we know at compile time *which* keys need fallback, we should store them explicitly:

```ts
// In templateCompiler.ts, add to CompiledNodeParams:
fallbackKeys?: string[];

// In workflowEngine.ts:
if (compiled.fallbackKeys) {
  for (const key of compiled.fallbackKeys) {
    resolved[key] = this.resolveDeep(resolved[key], input, allNodeData);
  }
}
```

This avoids the `Object.entries()` + `includes("{{")` scan on every bar.

---

## What's Well Done

- **`buildPathAccessor` depth specialization** (lines 110-131): Generating specific 1/2/3-key accessors instead of a generic loop is a textbook V8 optimization — monomorphic property access is significantly faster.
- **Graceful fallback**: The `compiled: false` path and try/catch in `preCompileAllNodes` ensure no regression if compilation fails for a node.
- **Regex hoisting** in `resolveReferences.ts` with proper `lastIndex = 0` reset — correct handling of the global flag.
- **`credential_id` filtering** at compile time — matches the runtime behavior.
- **Pure vs mixed template distinction** — preserving original types for pure templates (`{{ $json.price }}` → returns a number, not a string) is critical for downstream math operations.

---

## Recommended Changes (Priority Order)

| # | Issue | Severity | Effort |
|---|---|---|---|
| 1 | Fix `null` vs `full` parity mismatch in `resolveReferences.ts` | Bug | 1 line |
| 2 | Cache `pickJsonSource` shape per accessor | Performance | ~15 lines |
| 4 | Store `fallbackKeys` explicitly instead of re-scanning | Performance | ~10 lines |
| 3 | Mixed-string fast path for single-dynamic-segment | Minor | ~8 lines |

