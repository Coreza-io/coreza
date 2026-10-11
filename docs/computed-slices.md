# Computed slices in editable parameters

Enter an expression in an array-capable field (or choose **Array** as the Edit Fields result type) to select a suffix using another node's count:

```text
{{ $("get_atr_history").json.data.value[-$("short_len").json.data:] }}
```

Nested bounds also work without rewriting the saved expression:

```text
{{ $("get_atr_history").json.data.value[-{{ $("short_len").json.data }}:] }}
```

Bounds accept existing reference and arithmetic expressions. They must resolve to finite safe-integer numbers; strings are not coerced. Omitted bounds select the beginning or end. Negative bounds count from the end, oversized bounds clamp to the array, and `[-0:]` selects the whole array. Steps and computed property indexes remain unsupported. Versioned generic fields use the same grammar; unversioned legacy fields keep their existing grammar. See [expression fields](expression-fields.md) for typing, escaping and rollout.

The array and bounds use current canonical node outputs, including existing pins. Selecting a small suffix does not serialize unrelated history slots. Preview and server execution share validation, resource limits, and output checks. Deploy the updated backend before using the new frontend.

## Existing lastN expressions

The `lastN` function and its capability/repair UI are removed. Saved expressions remain editable and report a conversion diagnostic; they are not silently rewritten.

For a known positive count, explicitly replace `lastN(array, count)` with `array[-count:]`. Review zero counts separately: the retired helper returned `[]` for zero, while `array[-0:]` returns the whole array. Use `array[:0]` when an empty array is intended. Negative counts are now ordinary slice bounds, rather than helper argument errors. No stored workflow or database row is automatically migrated.
