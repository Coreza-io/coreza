import { isNodeResult } from "../../contracts/nodeResult";
import type { ReferenceNode } from "../../utils/referenceResolution";

/** Snapshot canonical identities and current results once per action/preview.
 * Availability comes from the execution context (including its existing pins),
 * never from static node configuration. Wrappers are preserved for pickJsonSource.
 */
export function snapshotTypedExpressionContext(
  nodes: readonly ReferenceNode[],
  getOutput: (id: string) => unknown,
): { nodeIdentities: ReferenceNode[]; nodeResults: Record<string, unknown> } {
  const nodeResults: Record<string, unknown> = Object.create(null);
  const nodeIdentities = nodes.map(node => {
    const data = node.data as Record<string, unknown> | undefined;
    const identity: ReferenceNode = { id: node.id };
    for (const [key, value] of Object.entries({
      displayName: node.displayName ?? data?.displayName,
      name: node.name ?? data?.name,
      label: node.label ?? data?.label,
    })) if (typeof value === "string") (identity as unknown as Record<string, unknown>)[key] = value;
    // title is also an explicit legacy alias; retain it without the rest of node data.
    if (typeof data?.title === "string") identity.data = { title: data.title };
    const output = getOutput(node.id);
    if (output !== undefined) nodeResults[node.id] = output;
    return identity;
  });
  return { nodeIdentities, nodeResults };
}

/** The same one-level envelope precedence as pickJsonSource, with data-property reads only. */
export function pickTypedJsonSource(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const read = (object: unknown, key: string) => {
    if (object === null || typeof object !== "object") return undefined;
    const property = Object.getOwnPropertyDescriptor(object, key);
    if (property && !("value" in property)) throw new Error(`Accessor envelope property "${key}" is not supported`);
    return property?.value;
  };
  // Recognize result envelopes without invoking accessors in expression data.
  if (Object.getOwnPropertyDescriptor(value, "status")?.value !== undefined) {
    const shape = Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value))
      .map(([key, property]) => [key, property.value]));
    if (isNodeResult(shape)) return value;
  }
  const json = read(value, "json"); if (json !== undefined) return json;
  const output = read(value, "output");
  const outputJson = read(output, "json"); if (outputJson !== undefined) return outputJson;
  if (output !== undefined) return output;
  const input = read(value, "input");
  const inputJson = read(input, "json"); if (inputJson !== undefined) return inputJson;
  if (input !== undefined) return input;
  const data = read(value, "data");
  const wrappedOutput = read(data, "output");
  const wrappedOutputJson = read(wrappedOutput, "json"); if (wrappedOutputJson !== undefined) return wrappedOutputJson;
  if (wrappedOutput !== undefined) return wrappedOutput;
  const wrappedInput = read(data, "input");
  const wrappedInputJson = read(wrappedInput, "json"); if (wrappedInputJson !== undefined) return wrappedInputJson;
  return wrappedInput !== undefined ? wrappedInput : value;
}
