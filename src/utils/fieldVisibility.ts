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

export const isFieldVisible = (
  field: any,
  currentFieldState: Record<string, any>
): boolean => {
  if (field.displayOptions?.show) {
    const showResult = Object.entries(field.displayOptions.show).every(
      ([depKey, rawAllowed]) => {
        const allowedValues = Array.isArray(rawAllowed)
          ? rawAllowed
          : [rawAllowed];
        const current = currentFieldState[depKey];
        if (Array.isArray(current)) {
          return current.some(v => allowedValues.includes(v));
        }
        return allowedValues.includes(current);
      }
    );

    if (!showResult) return false;
  }

  if (field.displayOptions?.hide) {
    const shouldHide = Object.entries(field.displayOptions.hide).some(
      ([depKey, rawAllowed]) => {
        const allowedValues = Array.isArray(rawAllowed)
          ? rawAllowed
          : [rawAllowed];
        const current = currentFieldState[depKey];
        return allowedValues.some((v: any) => {
          const compareVal =
            typeof v === 'object' && v !== null ? (v.id || v.value) : v;
          return String(current) === String(compareVal);
        });
      }
    );

    if (shouldHide) return false;
  }

  return true;
};

export const getVisibleValues = (
  definition: any,
  values: Record<string, any>
): Record<string, any> => {
  if (!definition?.fields || !values) return values || {};

  const result: Record<string, any> = {};
  const definedKeys = new Set(definition.fields.map((field: any) => field.key));

  for (const field of definition.fields) {
    if (!isFieldVisible(field, values)) continue;

    if (values[field.key] !== undefined) {
      result[field.key] = values[field.key];
    }
  }

  for (const [key, value] of Object.entries(values)) {
    if (!definedKeys.has(key) && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
};
