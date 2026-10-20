import type { WorkflowNode, WorkflowEdge, NodeInput } from '../nodes/types';
import { validateBrokerAttachments, effectiveHandles } from '../workflow/nodeRoles';
import { normalizeHistoricalConfiguration, historicalProvider, legacyHistoricalValues } from '../brokers/historicalConfiguration';
import { getBrokerConfig } from '../brokers';
import CredentialManager from '../utils/credentialManager';

export async function resolveBacktestBrokerAttachment(init: WorkflowNode, nodes: WorkflowNode[], edges: WorkflowEdge[], context: {userId?: string; resolveNodeParameters?: (node: WorkflowNode, input: NodeInput) => NodeInput}) {
  validateBrokerAttachments(nodes, edges);
  const incoming = edges.filter(e => e.target === init.id);
  let provider: string; let values: Record<string, any>; let brokerNodeId: string;
  const canonicalInit = nodes.find(n => n.id === init.id) ?? init;
  if (incoming.length === 0) {
    // Explicit legacy format only. New definitions carry the broker target even after disconnection.
    const legacy = canonicalInit.values ?? {};
    if ((canonicalInit as any).handles?.some((h: any) => h.id === 'broker') || !legacy.broker) throw new Error('Connect one broker to Backtest Init.');
    provider = String(legacy.broker).toLowerCase();
    brokerNodeId = init.id;
    values = legacyHistoricalValues(provider, context.resolveNodeParameters ? context.resolveNodeParameters(canonicalInit, {}) : legacy);
  } else {
    const source = nodes.find(n => n.id === incoming[0].source)!;
    provider = historicalProvider(source.name || '') || '';
    brokerNodeId = source.id;
    if (!effectiveHandles(source, source.values).some(h => h.id === incoming[0].sourceHandle && h.type === 'source')) throw new Error('Invalid broker source handle.');
    values = context.resolveNodeParameters ? context.resolveNodeParameters(source, {}) : {...source.values};
  }
  if (!getBrokerConfig(provider)?.operations.get_candle) throw new Error('The attached node does not support historical candles.');
  const resolved = normalizeHistoricalConfiguration(provider, values);
  const {credentials} = await CredentialManager.getCredentials(context.userId!, provider, resolved.credentialId, {useCache: false});
  if (!credentials) throw new Error(`Choose an authorized ${provider} credential on ${brokerNodeId}.`);
  return Object.freeze({...resolved, brokerNodeId});
}
