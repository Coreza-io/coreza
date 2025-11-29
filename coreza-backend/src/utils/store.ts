export function buildStoreKey(userId: string, workflowId: string, variableName: string): string {
  return `store:${userId}:${workflowId}:${variableName}`;
}

export function parseStoredValue(raw: string | null): unknown {
  if (raw === null) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw;
  }
}

export function extractVariableNameFromKey(key: string): string {
  const parts = key.split(":");

  // store:{userId}:{workflowId}:{variableName...}
  if (parts.length <= 3) {
    return parts[parts.length - 1];
  }

  // Preserve any additional colons that are part of the variable name
  return parts.slice(3).join(":");
}
