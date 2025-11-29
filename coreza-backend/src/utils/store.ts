export function normalizeVariableName(variableName: string): string {
  if (!variableName) return '';

  const segments = variableName.split(':');
  return segments[segments.length - 1];
}

export function buildStoreKey(userId: string, workflowId: string, variableName: string): string {
  const normalizedName = normalizeVariableName(variableName);
  return `store:${userId}:${workflowId}:${normalizedName}`;
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

/**
 * Resolve an existing Redis key for a variable name. If a normalized key does
 * not exist (e.g., legacy keys containing colons), fall back to a matching key
 * discovered via pattern search.
 */
export async function resolveStoreKey(
  redis: { get: (key: string) => Promise<string | null>; keys: (pattern: string) => Promise<string[]>; exists: (key: string) => Promise<number> },
  userId: string,
  workflowId: string,
  variableName: string
): Promise<string> {
  const normalizedName = normalizeVariableName(variableName);
  const normalizedKey = buildStoreKey(userId, workflowId, normalizedName);

  const exists = await redis.exists(normalizedKey);
  if (exists) return normalizedKey;

  const pattern = buildStoreKey(userId, workflowId, '*');
  const keys = await redis.keys(pattern);
  const fallback = keys.find((key) => normalizeVariableName(extractVariableNameFromKey(key)) === normalizedName);

  return fallback ?? normalizedKey;
}
