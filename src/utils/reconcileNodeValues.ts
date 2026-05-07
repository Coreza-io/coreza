/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */


function migrateAlpacaStreamDataValues(
  definition: any,
  merged: Record<string, any>,
): void {
  if (definition?.name !== "AlpacaStreamData") return;

  if (merged.assetType === "news") {
    merged.assetType = "stock";

    const current = merged.stream_type;
    const normalized = Array.isArray(current)
      ? [...current]
      : typeof current === "string"
        ? current
            .split(",")
            .map((v: string) => v.trim())
            .filter(Boolean)
        : [];

    if (!normalized.includes("news")) {
      normalized.push("news");
    }

    merged.stream_type = normalized.length > 0 ? normalized : ["news"];
  }
}

/**
 * Reconcile persisted node values against the current JSON definition.
 *
 * For every field in the definition that is missing from the persisted values,
 * this adds it with its default (or null). Existing user values are never
 * overwritten.
 *
 * Returns { merged, hadMissingKeys } so callers can decide whether to
 * write back to React Flow state.
 */
export function reconcileNodeValues(
  definition: any,
  existingValues: Record<string, any> = {},
  existingFieldState: Record<string, any> = {},
): { merged: Record<string, any>; hadMissingKeys: boolean } {
  if (!definition?.fields || !Array.isArray(definition.fields)) {
    return { merged: { ...existingValues }, hadMissingKeys: false };
  }

  const merged = { ...existingValues };
  let hadMissingKeys = false;

  for (const field of definition.fields) {
    const key = field.key as string;
    if (!key) continue;

    // Check both sources for an existing value
    const savedValue = merged[key] ?? existingFieldState[key];

    if (savedValue !== undefined) {
      // Already has a value — keep it, ensure it's in merged.
      // Normalize legacy empty strings to null for non-select fields.
      const isSelectType =
        field.type === "select" || field.type === "multiselect";
      merged[key] =
        !isSelectType &&
        typeof savedValue === "string" &&
        savedValue.trim() === ""
          ? null
          : savedValue;
    } else {
      // Missing key — backfill from definition
      hadMissingKeys = true;
      merged[key] = field.default ?? null;
    }
  }

  migrateAlpacaStreamDataValues(definition, merged);

  return { merged, hadMissingKeys };
}

/**
 * Compute a lightweight schema signature from a definition's fields.
 * Used to detect when the set of fields has structurally changed
 * (keys added/removed/retyped) without doing deep equality on the
 * entire definition object.
 */
export function getSchemaSignature(definition: any): string {
  if (!definition?.fields || !Array.isArray(definition.fields)) return "";
  return definition.fields
    .map((f: any) => `${f.key}:${f.type}`)
    .join("|");
}
