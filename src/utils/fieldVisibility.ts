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

type DisplayOptionsMap = Record<string, any>;

const matchesAllowedValues = (current: any, rawAllowed: any): boolean => {
  const allowedValues = Array.isArray(rawAllowed) ? rawAllowed : [rawAllowed];

  if (Array.isArray(current)) {
    return current.some((v) => allowedValues.includes(v));
  }

  return allowedValues.includes(current);
};

const shouldHideForValue = (current: any, rawAllowed: any): boolean => {
  const allowedValues = Array.isArray(rawAllowed) ? rawAllowed : [rawAllowed];

  return allowedValues.some((v: any) => {
    const compareVal =
      typeof v === "object" && v !== null ? v.id || v.value : v;
    return String(current) === String(compareVal);
  });
};

const filterDisplayOptions = (
  options: DisplayOptionsMap | undefined,
  ignoredKeys: string[] = [],
): DisplayOptionsMap | undefined => {
  if (!options) return undefined;

  const filteredEntries = Object.entries(options).filter(
    ([key]) => !ignoredKeys.includes(key),
  );

  if (filteredEntries.length === 0) return undefined;

  return Object.fromEntries(filteredEntries);
};

interface FieldEvaluationOptions {
  ignoreShowKeys?: string[];
  ignoreHideKeys?: string[];
}

const evaluateFieldDisplayRules = (
  field: any,
  currentFieldState: Record<string, any>,
  options: FieldEvaluationOptions = {},
): boolean => {
  const showOptions = filterDisplayOptions(
    field.displayOptions?.show,
    options.ignoreShowKeys,
  );

  if (showOptions) {
    const showResult = Object.entries(showOptions).every(
      ([depKey, rawAllowed]) => {
        const current = currentFieldState[depKey];
        return matchesAllowedValues(current, rawAllowed);
      },
    );

    if (!showResult) return false;
  }

  const hideOptions = filterDisplayOptions(
    field.displayOptions?.hide,
    options.ignoreHideKeys,
  );

  if (hideOptions) {
    const shouldHide = Object.entries(hideOptions).some(
      ([depKey, rawAllowed]) => {
        const current = currentFieldState[depKey];
        return shouldHideForValue(current, rawAllowed);
      },
    );

    if (shouldHide) return false;
  }

  return true;
};

export const isFieldVisible = (
  field: any,
  currentFieldState: Record<string, any>,
): boolean => {
  return evaluateFieldDisplayRules(field, currentFieldState);
};

export const shouldIncludeFieldInPayload = (
  field: any,
  currentFieldState: Record<string, any>,
  options: FieldEvaluationOptions = {},
): boolean => {
  return evaluateFieldDisplayRules(field, currentFieldState, options);
};



// Check if field is relevant for persistence (ignoring tab-based visibility keys)
const isFieldRelevantForPersistence = (
  field: any,
  currentFieldState: Record<string, any>,
  tabKeys: string[] = ["portfolio_tab"],
): boolean => {
  return shouldIncludeFieldInPayload(field, currentFieldState, {
    ignoreShowKeys: tabKeys,
  });
};

export const getVisibleValues = (
  definition: any,
  values: Record<string, any>,
): Record<string, any> => {
  if (!definition?.fields || !values) return values || {};

  const result: Record<string, any> = {};

  for (const field of definition.fields) {
    if (!isFieldRelevantForPersistence(field, values)) continue;

    if (values[field.key] !== undefined) {
      result[field.key] = values[field.key];
    }
  }

  // Preserve system-level keys not in definition.fields
  const systemKeys = ["checkDependency", "logicalOps", "__isTool"];
  for (const key of systemKeys) {
    if (values[key] !== undefined) {
      result[key] = values[key];
    }
  }

  return result;
};
