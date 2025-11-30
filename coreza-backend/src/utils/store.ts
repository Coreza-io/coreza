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
  return parts[parts.length - 1];
}

export function parseMembers(membersString: string): string[] {
  if (!membersString) return [];
  return membersString
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0);
}

export function parseScoreMembers(scoreMembersString: string): (number | string)[] {
  if (!scoreMembersString) return [];
  const pairs = scoreMembersString
    .split(',')
    .map(pair => pair.trim())
    .filter(pair => pair.length > 0);
  
  const result: (number | string)[] = [];
  for (const pair of pairs) {
    const [scoreStr, member] = pair.split(':').map(s => s.trim());
    if (scoreStr && member) {
      const score = parseFloat(scoreStr);
      if (!isNaN(score)) {
        result.push(score, member);
      }
    }
  }
  return result;
}
