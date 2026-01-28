

## Plan: Fix Empty String Value Error in Select Dropdown

### Problem

The separator item in `OpenAIChatModel.json` causes a crash:

```json
{ "label": "--- Web Search Models ---", "value": "", "disabled": true }
```

Radix UI's `SelectItem` doesn't allow empty string values because empty string is used to clear the selection.

### Solution

Two-part fix:

1. **Update JSON**: Give the separator a marker value that indicates it's a separator
2. **Update NodeFieldRenderer**: Detect separator items and render them using `SelectLabel` (for the text) instead of `SelectItem`

---

### Part 1: Update OpenAIChatModel.json

Change the separator value to a recognizable marker:

```json
{ 
  "label": "--- Web Search Models ---", 
  "value": "__separator__", 
  "disabled": true 
}
```

---

### Part 2: Update NodeFieldRenderer.tsx

In the section that renders select options (around line 264-268), add logic to handle separator items:

```typescript
{optionList.map((opt: any) => {
  // Handle separators/section headers
  if (opt.disabled && (opt.value === "" || opt.value === "__separator__" || opt.value?.startsWith("__separator"))) {
    return (
      <React.Fragment key={opt.label}>
        <SelectSeparator />
        <SelectLabel className="text-xs text-muted-foreground">{opt.label}</SelectLabel>
      </React.Fragment>
    );
  }
  
  return (
    <SelectItem key={opt.value ?? opt.label} value={opt.value} disabled={opt.disabled}>
      {opt.label ?? opt.value}
    </SelectItem>
  );
})}
```

This approach:
- Renders separators as a visual divider line (`SelectSeparator`) + label text (`SelectLabel`)
- Keeps them non-selectable (labels are naturally non-selectable)
- Works for any future separator items in other node definitions

---

### Additional Fix: Main Select Case (lines 474-480)

The same fix needs to be applied to the main select case around line 475:

```typescript
{displayOptions.map((opt: any) => {
  if (opt.disabled && (opt.value === "" || opt.value === "__separator__" || opt.value?.startsWith("__separator"))) {
    return (
      <React.Fragment key={opt.label}>
        <SelectSeparator />
        <SelectLabel className="text-xs text-muted-foreground">{opt.label}</SelectLabel>
      </React.Fragment>
    );
  }
  
  return (
    <SelectItem key={opt.id || opt.value} value={opt.id || opt.value} disabled={opt.disabled}>
      {opt.name || opt.label || opt.id || opt.value}
    </SelectItem>
  );
})}
```

---

### Files to Modify

| File | Change |
|------|--------|
| `src/nodes/OpenAIChatModel.json` | Change separator `value` from `""` to `"__separator__"` |
| `src/components/nodes/layout/components/NodeFieldRenderer.tsx` | Add separator detection logic in two places (lines ~264 and ~475) |

---

### Import Update

Add `SelectSeparator` and `SelectLabel` to the imports at the top of `NodeFieldRenderer.tsx`:

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectLabel } from "@/components/ui/select";
```

---

### Benefits

1. **Fixes the crash** - No more empty string value error
2. **Better UX** - Visual separator line + styled label looks cleaner than a disabled option
3. **Reusable pattern** - Any node definition can now use separators in dropdowns
4. **Backward compatible** - Existing nodes without separators work unchanged

