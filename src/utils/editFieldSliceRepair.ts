import { compileEditTemplate } from "../../coreza-backend/src/nodes/logic/editTemplate";
import { TYPED_EXPRESSION_FEATURES } from "../../coreza-backend/src/nodes/logic/safeExpression";

/** Offer a preview only for the recognized nested-reference suffix form. */
export function previewNestedSliceRepair(value: string): string | null {
  const match = /^(\s*\{\{\s*)([^{}]+)\[-\s*\{\{\s*([^{}]+?)\s*\}\}\s*:\s*\](\s*\}\}\s*)$/.exec(value);
  if (!match || !/^\$(?:\(|node\[)/.test(match[3])) return null;
  const candidate = `${match[1]}lastN(${match[2]}, ${match[3]})${match[4]}`;
  try { compileEditTemplate(candidate, TYPED_EXPRESSION_FEATURES); return candidate; }
  catch { return null; }
}
