import type { Node, Edge } from '@xyflow/react';
import type { NodeCluster } from './clusters/types';
import { allocateNodeName } from './nodeNaming';
import { nodeManifest } from '@/nodes/manifest';
import { BACKTEST_PROVIDERS, validateBrokerAttachments } from './nodeRoles';
import { legacyHistoricalValues, normalizeHistoricalConfiguration } from '../../coreza-backend/src/brokers/historicalConfiguration';

/** Builds a complete candidate. Callers commit it once through document history. */
export function migrateBacktestBrokers(document: {nodes: Node[]; edges: Edge[]; clusters: NodeCluster[]}) {
  const nodes = [...document.nodes]; const edges = [...document.edges];
  const clusters = document.clusters.map(c => ({...c, memberNodeIds: [...c.memberNodeIds]}));
  for (let index = 0; index < nodes.length; index++) {
    const init = nodes[index]; const definition = init.data.definition as any; const legacy = init.data.values as any;
    if (definition?.name !== 'BacktestInit' || !legacy?.broker || edges.some(e => e.target === init.id)) continue;
    const name = Object.keys(BACKTEST_PROVIDERS).find(k => BACKTEST_PROVIDERS[k] === legacy.broker);
    if (!name) throw new Error(`Repair unsupported legacy provider ${legacy.broker} on ${init.id}. Original configuration is retained.`);
    const values = legacyHistoricalValues(legacy.broker, legacy);
    normalizeHistoricalConfiguration(legacy.broker, values);
    const allocated = allocateNodeName(name, nodes);
    if (!allocated.ok) throw new Error('Cannot allocate a broker node name.');
    const brokerDefinition = nodeManifest[name as keyof typeof nodeManifest];
    const defaults = Object.fromEntries(brokerDefinition.fields.filter(f => f.default !== undefined).map(f => [f.key, f.default]));
    const brokerValues = {...defaults, ...values, __attachmentRole: 'backtestBroker'};
    const id = allocated.name;
    nodes.push({id, type: name, position: {x: init.position.x, y: init.position.y + 480}, data: {definition: brokerDefinition, displayName: id, values: brokerValues, fieldState: brokerValues}});
    const retained = Object.fromEntries(definition.fields.filter((f: any) => legacy[f.key] !== undefined).map((f: any) => [f.key, legacy[f.key]]));
    nodes[index] = {...init, data: {...init.data, values: retained, fieldState: retained}};
    edges.push({id: `edge_${crypto.randomUUID()}`, source: id, sourceHandle: 'broker', target: init.id, targetHandle: 'broker', type: 'removable'});
    clusters.find(c => c.memberNodeIds.includes(init.id))?.memberNodeIds.push(id);
  }
  validateBrokerAttachments(nodes, edges);
  return {nodes, edges, clusters};
}
