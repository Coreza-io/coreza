import { getBrokerConfig } from '../../brokers';
import { getFieldValueMode } from '../../utils/fieldValueModes';
import { loadNodeDefinition } from '../nodeDefinitions';
import type { WorkflowNode } from '../types';
import type { ToolInputContract } from './toolInputContract';

export function getToolInputContract(node: WorkflowNode, category: string): ToolInputContract | undefined {
  return category === 'Broker' ? getBrokerConfig(String((node as any).subCategory ?? node.name).toLowerCase())?.toolContract : undefined;
}

/** Unknown controllers expose optional fields, without prematurely injecting defaults. */
export function fieldApplicability(field: any, values: Record<string, any>, fixedOnly = false): 'active' | 'inactive' | 'unknown' {
  let unknown = false;
  for (const [kind, conditions] of Object.entries(field.displayOptions ?? {})) {
    if (kind !== 'show' && kind !== 'hide') continue;
    for (const [key, raw] of Object.entries(conditions as Record<string, any>)) {
      const current = values[key];
      if (current == null || current === '' || (fixedOnly && getFieldValueMode(values, key) !== 'fixed')) {
        unknown = true;
        continue;
      }
      const allowed = (Array.isArray(raw) ? raw : [raw]).map(value => value && typeof value === 'object' ? value.id ?? value.value : value);
      const matches = (Array.isArray(current) ? current : [current]).some(value => allowed.includes(value));
      if ((kind === 'show' && !matches) || (kind === 'hide' && matches)) return 'inactive';
    }
  }
  return unknown ? 'unknown' : 'active';
}

export function validateEffectiveToolInput(node: WorkflowNode, input: Record<string, any>, configured: Record<string, any>, raw: any, contract?: ToolInputContract) {
  const values = { ...input };
  const fields = (node as any).fields ?? loadNodeDefinition(node.name || '')?.fields ?? [];
  // Controllers precede dependent fields in node metadata. Only apply known-active defaults.
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(configured, field.key)) continue;
    if (values[field.key] == null && field.default !== undefined && fieldApplicability(field, values) === 'active') {
      values[field.key] = field.default;
    }
  }
  const reviewed = !!contract?.supports(values.operation);
  return { input: reviewed ? contract!.validate(values, configured, raw) : values,
    coverage: reviewed ? 'operation-reviewed' : 'legacy/unreviewed', contractId: reviewed ? contract!.id : undefined };
}
