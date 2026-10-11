import { prepareExpressionTransport, restoreExpressionTransport } from "./expressionTransport";
import { compileEditTemplate, evaluateEditTemplate } from './editTemplate';
import { ExpressionError, type ExpressionContext } from './safeExpression';
import { coerceFixedValue, checkExpressionResult, editFieldValueType, type EditFieldDataType } from './fieldValueTypes';

/** Lives in values so every existing document writer carries the dialect. Never an action parameter. */
export const EXPRESSION_VERSION_KEY = '__expressionFormatVersion';
export const EXPRESSION_FORMAT_VERSION = 1;
export const FIELD_EXPRESSION_FEATURES = Object.freeze({ computedSlices: true, strictJson: true, literalEscapes: true });
export const FIELD_ADAPTERS: Readonly<Record<string, EditFieldDataType | 'any' | 'structure'>> = Object.freeze({
  text: 'any', textarea: 'any', string: 'string', password: 'string', number: 'number',
  boolean: 'boolean', checkbox: 'boolean', toggle: 'boolean', select: 'any', 'grouped-select': 'any',
  multiselect: 'array', tags: 'array', json: 'any', object: 'object', array: 'array', repeater: 'array',
  hidden: 'structure', tabs: 'structure', webhookUrl: 'structure',
});
export interface FieldOption {
  value?: unknown;
  id?: unknown;
  valueMap?: { values?: Record<string, unknown> };
}
export interface FieldDescriptor {
  key: string;
  type: string;
  resultType?: EditFieldDataType | 'any';
  required?: boolean;
  nullable?: boolean;
  min?: number;
  max?: number;
  options?: FieldOption[];
  optionsSource?: string;
  groupedOptions?: Record<string, { options: FieldOption[] }>;
  dynamicOptions?: { dependsOn: string; optionsByValue: Record<string, FieldOption[]> };
  conditionalOptions?: Record<string, FieldOption[]>;
  dependsOn?: string;
  displayOptions?: { show?: Record<string, unknown>; hide?: Record<string, unknown> };
  subFields?: FieldDescriptor[];
  items?: FieldDescriptor;
}
export class FieldExpressionError extends Error {
  readonly code = 'FIELD_EXPRESSION_ERROR';
  constructor(message: string, public readonly details: {
    nodeId?: string; fieldPath: string; phase: string; position?: number; expected?: string; actual?: string;
  }, public readonly cause?: unknown) { super(`${details.nodeId ?? 'Node'}: ${details.fieldPath}: ${message}`); this.name = 'FieldExpressionError'; }
}
export function isExpressionContract(values: Record<string, unknown> | undefined): boolean {
  const version = values?.[EXPRESSION_VERSION_KEY];
  if (version !== undefined && version !== EXPRESSION_FORMAT_VERSION) throw new FieldExpressionError('Unsupported expression dialect', { fieldPath: EXPRESSION_VERSION_KEY, phase: 'configuration' });
  return version === EXPRESSION_FORMAT_VERSION;
}
export const escapeFieldLiteral = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\{\{/g, '\\{{');

export function compileFieldValue(raw: unknown, descriptor: FieldDescriptor, fieldPath = descriptor.key) {
  const expected = descriptor.resultType ?? FIELD_ADAPTERS[descriptor.type];
  if (!expected) throw new FieldExpressionError(`Unsupported field adapter ${descriptor.type}`, { fieldPath, phase: 'configuration' });
  if (typeof raw === 'string' && (expected === 'array' || expected === 'object' || descriptor.type === 'json')) {
    try { const literal = JSON.parse(raw); if (literal && typeof literal === 'object') raw = literal; } catch { /* Template or invalid JSON is diagnosed by normal compilation/coercion. */ }
  }
  if (expected === 'structure') return { raw, descriptor, fieldPath, expected, template: undefined };
  try {
    const template = typeof raw === 'string' && (raw.includes('{{') || raw.includes('\\\\'))
      ? compileEditTemplate(raw, FIELD_EXPRESSION_FEATURES) : undefined;
    return { raw, descriptor, fieldPath, expected, template };
  } catch (error) {
    throw new FieldExpressionError(error instanceof Error ? error.message : String(error), { fieldPath, phase: 'compile', position: error instanceof ExpressionError ? error.position : undefined, expected, actual: editFieldValueType(raw) }, error);
  }
}
export type CompiledFieldValue = ReturnType<typeof compileFieldValue>;
export function evaluateFieldValue(compiled: CompiledFieldValue, context: ExpressionContext, nodeId?: string): unknown {
  const { descriptor, expected, fieldPath, raw, template } = compiled;
  let phase = 'evaluate'; let value: unknown = raw;
  try {
    if (expected === 'structure') return raw;
    if (template) {
      const transported = context.fieldContexts?.[fieldPath];
      const fieldContext = transported === undefined ? context : { ...context, ...restoreExpressionTransport(transported) };
      value = evaluateEditTemplate(template, fieldContext);
    }
    phase = 'type';
    if (value === undefined || value === null || value === '' && (expected === 'string' || expected === 'any')) {
      if (descriptor.required) throw new Error('Required value is missing');
      if (value === null && descriptor.nullable === false) throw new Error('Null is not allowed');
      return value;
    }
    const isCode = template?.segments.some(segment => segment.kind === 'code');
    if (expected !== 'any') value = isCode || typeof value !== 'string' ? checkExpressionResult(value, expected, fieldPath) : coerceFixedValue(value, expected);
    else if (descriptor.type === 'json' && typeof value === 'string' && !isCode) value = JSON.parse(value);
    if (typeof value === 'number' && (!Number.isFinite(value) || descriptor.min !== undefined && value < descriptor.min || descriptor.max !== undefined && value > descriptor.max)) throw new Error('Number is outside the allowed bounds');
    return value;
  } catch (error) {
    throw new FieldExpressionError(error instanceof Error ? error.message : String(error), { nodeId, fieldPath, phase: error instanceof ExpressionError ? error.phase : phase, position: error instanceof ExpressionError ? error.position : undefined, expected, actual: editFieldValueType(value) }, error);
  }
}
/** Raw-source HTTP owners key packets by stable descriptor path, never array-index-only metadata. */
export function prepareFieldExpressionTransport(compiled: CompiledFieldValue, context: ExpressionContext): unknown {
  return compiled.template ? prepareExpressionTransport(compiled.template, context) : undefined;
}
export function collectFieldReferences(compiled: CompiledFieldValue): readonly string[] { return compiled.template?.nodeReferences ?? []; }

function included(field: FieldDescriptor, read: (key: string) => unknown): boolean {
  const matches = (value: unknown, options: unknown) => {
    const allowed = Array.isArray(options) ? options : [options];
    return Array.isArray(value) ? value.some(v => allowed.includes(v)) : allowed.includes(value);
  };
  return Object.entries(field.displayOptions?.show ?? {}).every(([key, allowed]) => key === 'portfolio_tab' || matches(read(key), allowed)) &&
    !Object.entries(field.displayOptions?.hide ?? {}).some(([key, allowed]) => key !== 'portfolio_tab' && matches(read(key), allowed));
}
function validateOptions(field: FieldDescriptor, value: unknown, read: (key: string) => unknown, nodeId: string | undefined, fieldPath: string): void {
  if (value == null || value === '' || field.optionsSource) return;
  const options = field.dynamicOptions ? field.dynamicOptions.optionsByValue[String(read(field.dynamicOptions.dependsOn))]
    : field.conditionalOptions ? field.conditionalOptions[String(read(field.dependsOn!))]
    : field.groupedOptions ? Object.values(field.groupedOptions).flatMap(group => group.options) : field.options;
  if (!options?.length) return;
  if (field.type === 'multiselect' && Array.isArray(value)) {
    const allowed = options.flatMap(option => [option.id ?? option.value, ...Object.values(option.valueMap?.values ?? {})]);
    if (value.some(item => !allowed.includes(item))) throw new FieldExpressionError('Value is not an allowed option', { nodeId, fieldPath, phase: 'type', actual: 'Array' });
    return;
  }
  if (field.type !== 'select' && field.type !== 'grouped-select') return;
  if (!options.some(option => (('id' in option ? option.id : undefined) ?? option.value) === value))
    throw new FieldExpressionError('Value is not an allowed option', { nodeId, fieldPath, phase: 'type', actual: editFieldValueType(value) });
}

export function compileNodeFieldValues(values: Record<string, unknown>, fields: readonly FieldDescriptor[], nodeId?: string, prefix = ''): { references: string[]; resolve: (context: ExpressionContext) => Record<string, unknown> } {
  const byKey = new Map(fields.map(field => [field.key, field]));
  const compile = (raw: unknown, descriptor: FieldDescriptor, path: string): CompiledFieldValue => {
    try { return compileFieldValue(raw, descriptor, path); }
    catch (error) {
      if (error instanceof FieldExpressionError) throw new FieldExpressionError(error.cause instanceof Error ? error.cause.message : error.message, { ...error.details, nodeId }, error.cause);
      throw error;
    }
  };
  const compiled = new Map(fields.filter(field => Object.prototype.hasOwnProperty.call(values, field.key)).map(field => [field.key, compile(values[field.key], field, `${prefix}${field.key}`)]));
  const references = new Set<string>();
  const rows = new Map<string, ReturnType<typeof compileNodeFieldValues>[]>();
  const objects = new Map<string, ReturnType<typeof compileNodeFieldValues>>();
  const items = new Map<string, CompiledFieldValue[]>();
  const rowValues = new Map<string, (Map<EditFieldDataType, CompiledFieldValue | Error> | undefined)[]>();
  for (const field of fields) {
    const compiledField = compiled.get(field.key);
    const raw = compiledField?.raw ?? values[field.key];
    if (compiledField) collectFieldReferences(compiledField).forEach(name => references.add(name));
    if (field.items && Array.isArray(raw)) {
      const plans = raw.map((value, index) => compile(value, field.items!, `${prefix}${field.key}[${index}]`));
      plans.forEach(plan => collectFieldReferences(plan).forEach(name => references.add(name)));
      items.set(field.key, plans);
    }
    if (field.type === 'object' && raw && typeof raw === 'object' && field.subFields) {
      const plan = compileNodeFieldValues(raw as Record<string, unknown>, field.subFields, nodeId, `${prefix}${field.key}.`);
      objects.set(field.key, plan); plan.references.forEach(name => references.add(name));
    }
    if (field.type === 'repeater' && Array.isArray(raw)) {
      const plans = raw.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new FieldExpressionError('Invalid repeater row', { nodeId, fieldPath: `${prefix}${field.key}[${index}]`, phase: 'configuration' });
        const record = row as Record<string, unknown>;
        const plan = compileNodeFieldValues(record, (field.subFields ?? []).filter(child => child.key !== 'value' || record.expression_format_version !== 1), nodeId, `${prefix}${field.key}[${index}].`);
        plan.references.forEach(name => references.add(name));
        return plan;
      });
      const values = raw.map((row, index) => {
        const record = row as Record<string, unknown>;
        if (record.expression_format_version !== 1) return undefined;
        const variants = new Map<EditFieldDataType, CompiledFieldValue | Error>();
        const types: EditFieldDataType[] = ['string', 'number', 'boolean', 'array', 'object'];
        const staticType = types.includes(record.dataType as EditFieldDataType) ? record.dataType as EditFieldDataType : undefined;
        for (const type of staticType ? [staticType] : types) {
          try {
            const value = compile(record.value, { key: 'value', type }, `${prefix}${field.key}[${index}].value`);
            collectFieldReferences(value).forEach(name => references.add(name)); variants.set(type, value);
          } catch (error) { if (staticType) throw error; variants.set(type, error instanceof Error ? error : new Error(String(error))); }
        }
        return variants;
      });
      rows.set(field.key, plans); rowValues.set(field.key, values);
    }
  }
  const resolve = (context: ExpressionContext): Record<string, unknown> => {
    const out: Record<string, unknown> = Object.create(null); const resolving = new Set<string>();
    const read = (key: string): unknown => {
      if (Object.prototype.hasOwnProperty.call(out, key)) return out[key];
      if (!compiled.has(key)) return values[key];
      if (resolving.has(key)) throw new FieldExpressionError('Cyclic field visibility dependency', { nodeId, fieldPath: key, phase: 'configuration' });
      resolving.add(key);
      try {
        const field = byKey.get(key)!;
        if (!included(field, read)) return undefined;
        let value = evaluateFieldValue(compiled.get(key)!, context, nodeId);
        if (items.has(key)) value = items.get(key)!.map(plan => { const result = evaluateFieldValue(plan, context, nodeId); validateOptions(plan.descriptor, result, read, nodeId, plan.fieldPath); return result; });
        if (objects.has(key)) value = objects.get(key)!.resolve(context);
        if (rows.has(key)) value = rows.get(key)!.map((plan, index) => {
          const resolved = plan.resolve(context);
          const source = rowValues.get(key)?.[index];
          if (source) {
            const type = resolved.dataType as EditFieldDataType;
            if (!['string', 'number', 'boolean', 'array', 'object'].includes(type)) throw new FieldExpressionError('Invalid row type', { nodeId, fieldPath: `${prefix}${key}[${index}].dataType`, phase: 'type' });
            const variant = source.get(type)!;
            if (variant instanceof Error) throw variant;
            resolved.value = evaluateFieldValue(variant, context, nodeId);
            resolved.valueMode = 'fixed'; // Application boundary: resolved strings are data.
            delete resolved.expression_format_version;
          }
          return resolved;
        });
        if (field.type === 'repeater' && !rows.has(key) && Array.isArray(value)) value = value.map((row, index) => {
          if (!row || typeof row !== 'object' || (row as Record<string, unknown>).expression_format_version !== 1) return row;
          const record = row as Record<string, unknown>;
          const type = record.dataType as EditFieldDataType;
          if (!['string', 'number', 'boolean', 'array', 'object'].includes(type)) throw new FieldExpressionError('Invalid row type', { nodeId, fieldPath: `${prefix}${key}[${index}].dataType`, phase: 'type' });
          const { expression_format_version, ...resolved } = record;
          return { ...resolved, value: checkExpressionResult(record.value, type, `${prefix}${key}[${index}].value`), valueMode: 'fixed' };
        });
        validateOptions(field, value, read, nodeId, key);
        out[key] = value;
        return value;
      } finally { resolving.delete(key); }
    };
    for (const field of fields) { if (field.key in values) read(field.key); else if (field.required && included(field, read)) throw new FieldExpressionError('Required value is missing', { nodeId, fieldPath: field.key, phase: 'type' }); }
    // Unknown values and row metadata survive; never interpret structure as source.
    for (const [key, value] of Object.entries(values)) if (!byKey.has(key) && key !== EXPRESSION_VERSION_KEY) out[key] = value;
    return out;
  };
  return { references: [...references], resolve };
}

export function normalizeExpressionRows(raw: unknown): unknown {
    if (Array.isArray(raw)) return raw.map(normalizeExpressionRows);
    if (!raw || typeof raw !== 'object') return raw;
    const row = raw as Record<string, unknown>;
    if ('fieldName' in row && 'dataType' in row && (row.valueMode === 'fixed' || row.valueMode === 'expression')) {
      const { valueMode, ...rest } = row;
      let value = row.value;
      if (valueMode === 'fixed') {
        value = coerceFixedValue(value, row.dataType as EditFieldDataType);
        if (typeof value === 'string') value = escapeFieldLiteral(value);
      }
      return { ...rest, value, expression_format_version: 1 };
    }
    return raw;
}

function migrateLegacyFieldSource(raw: unknown, field: FieldDescriptor): unknown {
  if (field.type === 'repeater') raw = normalizeExpressionRows(raw);
  if (raw && typeof raw === 'object' && (raw as Record<string, unknown>).expression_format_version === 1) return raw;
  if (Array.isArray(raw) && field.type === 'repeater') return raw.map(row => {
    if (!row || typeof row !== 'object' || (row as Record<string, unknown>).expression_format_version === 1) return row;
    const migrated = { ...row as Record<string, unknown> };
    for (const child of field.subFields ?? []) if (child.key in migrated) migrated[child.key] = migrateLegacyFieldSource(migrated[child.key], child);
    return migrated;
  });
  if (typeof raw !== 'string' || FIELD_ADAPTERS[field.type] === 'structure') return raw;
  if (!raw.includes('{{')) return escapeFieldLiteral(raw);
  const template = compileEditTemplate(raw, FIELD_EXPRESSION_FEATURES);
  for (const segment of template.segments) if (segment.kind === 'code') {
    // The legacy resolver supports accessors, not generic arithmetic/calls. Do not
    // reinterpret a saved source that its permissive path scanner read differently.
    const accessor = /^(?:\$json|\$\(\s*(?:"[^"\\]*"|'[^'\\]*')\s*\)\s*\.json|\$node\[\s*(?:"[^"\\]*"|'[^'\\]*')\s*\]\s*\.json)(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[\s*(?:-?\d+|(?:-?\d*)?:(?:-?\d*)?|"[^"\\]*"|'[^'\\]*')\s*\])*\s*$/;
    if (!accessor.test(segment.value)) throw new FieldExpressionError('Legacy source needs an explicit conversion before changing dialect', { fieldPath: field.key, phase: 'migration', position: segment.expressionStart });
  }
  return raw;
}

/** Builds a candidate only; callers commit it through canonical document commands. */
export function migrateNodeExpressionValues(values: Record<string, unknown>, fields: readonly FieldDescriptor[]): Record<string, unknown> {
  if (isExpressionContract(values)) return values;
  const candidate = { ...values, ...Object.fromEntries(fields.filter(field => field.key in values).map(field => [field.key, migrateLegacyFieldSource(values[field.key], field)])), [EXPRESSION_VERSION_KEY]: 1 };
  compileNodeFieldValues(candidate, fields); // Unsupported legacy syntax keeps the original document unchanged.
  return candidate;
}
