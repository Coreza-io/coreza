import { compileEditTemplate, evaluateEditTemplate, type CompiledEditTemplate } from "../nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../nodes/logic/safeExpression";
import { pickTypedJsonSource } from "../nodes/logic/typedExpressionContext";
import type { ReferenceNode } from "./referenceResolution";

/** Keep legacy references unchanged; computed slices use the shared bounded parser. */
export function compileComputedSliceReference(source: string): CompiledEditTemplate | undefined {
  if (!source.includes("{{") || !source.includes("[") || !source.includes(":")) return undefined;
  try {
    const compiled = compileEditTemplate(source, TYPED_EXPRESSION_FEATURES);
    return compiled.hasComputedSlices ? compiled : undefined;
  } catch (error) {
    // A malformed dynamic bound must surface its diagnostic, not become partial text.
    if (/\[[^\]]*(?:\$|\{\{)|:[^\]]*(?:\$|\{\{)/.test(source)) throw error;
    return undefined;
  }
}

export function evaluateComputedSliceReference(
  compiled: CompiledEditTemplate,
  input: unknown,
  outputs: Record<string, unknown> = {},
  nodes: readonly ReferenceNode[] = [],
): unknown {
  return evaluateEditTemplate(compiled, {
    $json: pickTypedJsonSource(input),
    $nodes: outputs,
    expressionOutputs: outputs,
    nodes: [...nodes],
  });
}
