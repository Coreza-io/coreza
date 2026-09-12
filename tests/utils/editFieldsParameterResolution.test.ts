import { describe, expect, test } from "vitest";
import { ParameterResolver } from "../../coreza-backend/src/engine/parameterResolver";
import type { WorkflowNode } from "../../coreza-backend/src/nodes/types";
import { applyFieldRows } from "../../coreza-backend/src/nodes/logic/editFields";

describe("Edit Fields parameter resolution", () => {
  test("preserves expression values while resolving fixed templates", () => {
    const node: WorkflowNode = {
      id: "edit-fields",
      name: "Edit Fields",
      node_type: "main",
      category: "Logic",
      values: {
        fields: [
          {
            fieldName: "expression",
            dataType: "boolean",
            valueMode: "expression",
            value: "{{ $json.close > 100 }}",
          },
          {
            fieldName: "fixed",
            dataType: "number",
            valueMode: "fixed",
            value: "{{ $json.close }}",
          },
        ],
      },
    };

    const resolved = new ParameterResolver([node]).resolve(
      node,
      { close: 120 },
      () => ({}),
    );
    expect(resolved.fields[0].value).toBe("{{ $json.close > 100 }}");
    expect(resolved.fields[1].value).toBe("{{ $json.close }}");

    expect(
      applyFieldRows(
        [
          {
            fieldName: "fixed",
            dataType: "string",
            valueMode: "fixed",
            value: resolved.fields[1].value,
          },
        ],
        { input: { close: 120 }, legacyResultSeed: {} },
      ).fixed,
    ).toBe("{{ $json.close }}");
    expect(() =>
      applyFieldRows(resolved.fields, {
        input: { close: 120 },
        legacyResultSeed: {},
      }),
    ).toThrow("expected Number");
  });
});
