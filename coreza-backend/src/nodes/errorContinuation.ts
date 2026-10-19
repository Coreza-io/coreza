/** Node-level policy, separate from Loop's existing per-item continueOnError option. */
export function canContinueNodeError(name: string | undefined, values: Record<string, any>): boolean {
  return values.__continueOnError === true && !(name === "Edit Fields" && values.persistent === true);
}

/** Continue regular nodes with error data, control nodes through one regular output. */
export function continuedNodeError(name: string | undefined, values: Record<string, any>, message: string, code?: string) {
  const firstCase = Array.isArray(values.cases) ? values.cases[0]?.outputName : values.cases?.outputName;
  const continuation = name === "Loop" ? "done"
    : name === "If" ? "true"
    : name === "Switch" ? (typeof firstCase === "string" && firstCase ? firstCase : "case1")
    : undefined;
  return {
    success: false,
    status: "error",
    error: message,
    data: { error: message },
    result: continuation,
    ...(code !== undefined ? { code } : {}),
    ...(name === "Loop" ? { control: { loopCompleted: true } } : {}),
  };
}
