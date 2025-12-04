/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
