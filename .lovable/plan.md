

# Plan: Fix `isSearchModel` Not in Payload

## Problem

When a user selects "GPT-4o Search" model, the frontend stores only the value (`"gpt-4o-search-preview"`) in `values.model`, but does NOT extract the `isSearchModel: true` flag from the option object. The backend expects `values.isSearchModel` but it's never set.

**Current flow:**
```
User selects "GPT-4o Search" 
  → handleChange("model", "gpt-4o-search-preview")
  → values = { model: "gpt-4o-search-preview" }  // isSearchModel NOT included
```

**Expected flow:**
```
User selects "GPT-4o Search"
  → handleChange("model", "gpt-4o-search-preview")
  → Find option with value="gpt-4o-search-preview"
  → Extract isSearchModel=true from option
  → values = { model: "gpt-4o-search-preview", isSearchModel: true }
```

---

## Solution

Modify `useNodeFieldState.ts` to extract metadata flags from selected options when a select field changes.

---

## File to Modify

| File | Change |
|------|--------|
| `src/hooks/useNodeFieldState.ts` | In `handleChange`, extract option metadata for select fields |

---

## Implementation

Update the `handleChange` function to look up the selected option and copy any additional metadata (like `isSearchModel`) to the field state:

```typescript
// In handleChange, around line 158
const handleChange = useCallback(
  (key: string, value: any) => {
    if (readOnly) return;
    
    let newFieldState = { ...fieldState, [key]: value };
    
    // For select fields, extract any metadata from the selected option
    if (definition?.fields) {
      const field = definition.fields.find((f: any) => f.key === key);
      if (field?.type === "select" && field?.options) {
        const selectedOption = field.options.find(
          (opt: any) => opt.value === value || opt.id === value
        );
        
        // Copy option metadata flags to fieldState (e.g., isSearchModel)
        if (selectedOption) {
          // List of known metadata keys to extract from options
          const optionMetadataKeys = ["isSearchModel", "modelKwargs", "noTemperature"];
          
          for (const metaKey of optionMetadataKeys) {
            if (selectedOption[metaKey] !== undefined) {
              newFieldState[metaKey] = selectedOption[metaKey];
            } else {
              // Clear the flag if switching to an option without it
              delete newFieldState[metaKey];
            }
          }
        }
      }
      
      // Existing: Check if any field has dynamicOptions that depends on this key
      for (const f of definition.fields) {
        if (f.dynamicOptions?.dependsOn === key) {
          const options = f.dynamicOptions.optionsByValue?.[value];
          if (options && options.length > 0) {
            newFieldState[f.key] = options[0].value;
          }
        }
      }
    }
    
    setFieldState(newFieldState);
    // ... rest of function
  },
  [fieldState, nodeId, setNodes, definition?.fields, readOnly]
);
```

---

## How It Works

1. User selects "GPT-4o Search" from dropdown
2. `handleChange("model", "gpt-4o-search-preview")` is called
3. Function finds the field definition for "model"
4. Function finds the option with `value: "gpt-4o-search-preview"`
5. Function sees `isSearchModel: true` on that option
6. Function sets `newFieldState.isSearchModel = true`
7. `values` now contains `{ model: "gpt-4o-search-preview", isSearchModel: true }`
8. When serialized to backend, `chatModelNode.values.isSearchModel` is `true`

---

## Benefits

- Generic solution that works for any option metadata
- Metadata is available in `values` for all use cases
- No backend changes needed
- Future option flags automatically extracted (just add to `optionMetadataKeys` list)

---

## Summary

| Before | After |
|--------|-------|
| `values = { model: "gpt-4o-search-preview" }` | `values = { model: "gpt-4o-search-preview", isSearchModel: true }` |
| Backend: `chatModelNode.values?.isSearchModel = undefined` | Backend: `chatModelNode.values?.isSearchModel = true` |

