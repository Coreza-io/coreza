

# Plan: Fix TypeScript Error in listeningConfigs.ts

## Problem

The `listeningConfigs.ts` file has a TypeScript error:

```
Type '"provider"' is not assignable to type 'optionalKeys<...>'
```

This occurs because:
1. `listeningConfigs.ts` uses `Pick<NodeConfig, "name" | "provider" | "streamingConfig">`
2. But `NodeConfigSchema` doesn't include a `provider` field
3. Several node JSONs already use `provider` (WebhookTrigger, TelegramTrigger, OpenAIChatModel, GeminiChatModel)

## Solution

Add the `provider` field to `NodeConfigSchema` since it's already used in multiple node definitions.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/nodes/schemas/nodeSchema.ts` | Add `provider` field to NodeConfigSchema |

---

## Implementation

### Update NodeConfigSchema

Add `provider: z.string().optional()` to the schema alongside other optional metadata fields:

```typescript
export const NodeConfigSchema = z
  .object({
    name: z.string().min(1),
    node_type: z.enum(["main", "sub", "trigger", "backtest", "schwab"]),
    handles: z.array(HandleSchema).min(1),
    fields: z.array(FieldSchema),

    def: z.string().optional(),
    label: z.string().optional(),
    category: z.string().optional(),
    subCategory: z.string().optional(),
    subcategory: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
    icon: z.string().optional(),
    size: SizeSchema.optional(),
    parentNode: z.string().optional(),
    type: z.string().optional(),
    provider: z.string().optional(),        // <-- ADD THIS
    streamingConfig: StreamingConfigSchema.optional(),
    listeningConfig: ListeningConfigSchema.optional(),  // <-- ALSO ADD THIS

    action: ActionSchema.optional(),
    // ... rest unchanged
  })
```

### Add ListeningConfigSchema

Since `listeningConfig` is also used in node JSONs but not in the schema, add it too:

```typescript
export const ListeningConfigSchema = z.object({
  provider: z.string().optional(),
  waitField: z.string().optional(),
  timeout: z.number().optional(),
  listeningFlag: z.string().optional(),
});
```

---

## Why This Approach

| Alternative | Reason Not Chosen |
|-------------|-------------------|
| Define type inline in listeningConfigs.ts | Doesn't fix the schema - validation would miss `provider` in JSONs |
| Remove provider from Pick | Still need provider in the function, would just hide the typing issue |
| Use `any` type | Loses type safety |

Adding to the schema is the correct fix because:
1. `provider` is already used in 4+ node JSON files
2. It aligns with the "single source of truth" architecture
3. The validation script will now properly validate nodes with `provider`
4. Type inference will work correctly throughout the codebase

---

## Summary

| Change | Impact |
|--------|--------|
| Add `provider: z.string().optional()` to NodeConfigSchema | Fixes TS2344 error |
| Add `ListeningConfigSchema` | Enables validation of listeningConfig in node JSONs |
| Add `listeningConfig` to NodeConfigSchema | Complete schema coverage |

This is a minimal fix that brings the schema in sync with the actual node JSON structures being used.

