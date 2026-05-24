import { NODE_VISUAL_THEMES } from "./nodeVisualThemes";
import type { NodeVisualCategory } from "./nodeVisualThemes";

const compact = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const NORMALIZED_TO_CATEGORY: Record<string, NodeVisualCategory> =
  Object.fromEntries(
    (Object.keys(NODE_VISUAL_THEMES) as NodeVisualCategory[]).map((category) => [
      compact(category),
      category,
    ]),
  );

export function resolveNodeVisualCategory(definition: unknown): NodeVisualCategory {
  const maybeCategory =
    typeof definition === "object" && definition !== null && "category" in definition
      ? Reflect.get(definition, "category")
      : undefined;

  return NORMALIZED_TO_CATEGORY[compact(maybeCategory)] ?? "Logic";
}
