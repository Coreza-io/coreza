import type { Edge, Node } from '@xyflow/react';
import { hashEditableWorkflowContent, serializeWorkflowContent } from '../src/domain/workflowDocument';

const nodes: Node[] = [
  {
    id: 'a',
    type: 'Example',
    position: { x: 10, y: 20 },
    data: {
      definition: { name: 'Example', node_type: 'main', handles: [{ id: 'out', type: 'source', connectionKind: 'main' }] },
      values: { nested: { enabled: true } },
      pinnedOutput: { value: 7 },
      output: { transient: true },
    },
  },
  {
    id: 'b',
    type: 'Example',
    position: { x: 30, y: 40 },
    data: { definition: { name: 'Example', node_type: 'main', handles: [{ id: 'in', type: 'target', connectionKind: 'main' }] }, values: {} },
  },
];

const edges: Edge[] = [{ id: 'edge', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', data: { label: 'kept', onRemoveEdge: () => undefined } }];
const cluster = { id: '123e4567-e89b-42d3-a456-426614174000', title: ' Group ', note: ' note ', memberNodeIds: ['b', 'a', 'a'] };

describe('workflow document serialization', () => {
  it('preserves canonical graph data and normalizes cluster metadata', () => {
    const content = serializeWorkflowContent(' Workflow ', null, nodes, edges, [cluster]);
    expect(content.name).toBe('Workflow');
    expect(content.nodes[0]).toMatchObject({ position: { x: 10, y: 20 }, values: { nested: { enabled: true } }, pinnedOutput: { value: 7 } });
    expect(content.edges[0]).toMatchObject({ id: 'edge', sourceHandle: 'out', targetHandle: 'in', data: { label: 'kept' } });
    expect(content.clusters[0]).toEqual({ ...cluster, title: 'Group', note: 'note', memberNodeIds: ['a', 'b'] });
  });

  it('deep clones snapshots and excludes runtime-only state from the dirty hash', () => {
    const first = serializeWorkflowContent('Workflow', null, nodes, edges, [cluster]);
    const secondNodes = nodes.map((node) => ({ ...node, selected: true, data: { ...node.data, output: { changed: true } } }));
    const second = serializeWorkflowContent('Workflow', null, secondNodes, edges, [cluster]);
    expect(hashEditableWorkflowContent(first)).toBe(hashEditableWorkflowContent(second));
    (nodes[0].data.values as { nested: { enabled: boolean } }).nested.enabled = false;
    expect(first.nodes[0].values).toEqual({ nested: { enabled: true } });
  });

  it('rejects canonical edges whose endpoints do not exist', () => {
    expect(() => serializeWorkflowContent('Workflow', null, nodes, [{ ...edges[0], target: 'missing' }], [])).toThrow('invalid-edge-endpoint');
  });
});
