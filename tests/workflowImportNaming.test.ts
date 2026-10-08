jest.mock('@/nodes/manifest', () => ({ nodeManifest: {
  Switch: jest.requireActual('../src/nodes/Switch.json'),
  If: jest.requireActual('../src/nodes/If.json'),
} }));

import { importWorkflow } from '../src/utils/workflowExport';
import { resolveReferences } from '../src/utils/resolveReferences';

const position = { x: 0, y: 0 };
const file = (nodes: unknown[], edges: unknown[] = [], clusters: unknown[] = []) => ({
  text: async () => JSON.stringify({ meta: { source: 'coreza' }, name: 'Test', nodes, edges, clusters }),
} as File);

it.each([`{{ $('Legacy').json.marker }}`, '{{ $node["Legacy"].json.marker }}'])(
  'rejects an ambiguous imported selector before name allocation: %s', async (expression) => {
    const nodes = [
      { id: 'a', type: 'If', displayName: 'Legacy', position },
      { id: 'b', type: 'If', displayName: 'Legacy', position },
      { id: 'consumer', type: 'If', position, values: { fields: [{ value: expression }] } },
    ];
    await expect(importWorkflow(file(nodes))).rejects.toThrow('Ambiguous node reference "Legacy"');
  },
);

it('allows duplicate aliases with no ambiguous selectors and preserves exact-ID precedence', async () => {
  const unused = await importWorkflow(file([
    { id: 'a', type: 'If', displayName: 'Legacy', position },
    { id: 'b', type: 'If', displayName: 'Legacy', position },
  ]));
  expect(unused.nodes.map((node) => node.displayName)).toEqual(['Legacy', 'Legacy1']);

  const imported = await importWorkflow(file([
    { id: 'Legacy', type: 'If', displayName: 'Public', position },
    { id: 'b', type: 'If', displayName: 'Legacy', position },
    { id: 'consumer', type: 'If', position, values: { value: `{{ $('Legacy').json.marker }}` } },
  ]));
  const output = { [imported.nodes[0].id]: { marker: 'exact' }, [imported.nodes[1].id]: { marker: 'alias' } };
  expect(resolveReferences(imported.nodes[2].values!.value, {}, output, imported.nodes)).toBe('exact');
});

it('imports a valid dynamic Switch branch and remaps its cluster and endpoints', async () => {
  const nodes = [
    { id: 'Switch', type: 'Switch', position, values: { cases: [{ outputName: 'Long' }] } },
    { id: 'If', type: 'If', position },
  ];
  const edges = [{ id: 'edge', source: 'Switch', target: 'If', sourceHandle: 'Long', targetHandle: 'input' }];
  const clusters = [{ id: '00000000-0000-4000-8000-000000000001', title: 'Cluster', memberNodeIds: ['Switch', 'If'] }];
  const imported = await importWorkflow(file(nodes, edges, clusters));
  const ids = imported.nodes.map((node) => node.id);
  expect(ids).not.toEqual(['Switch', 'If']);
  expect([...imported.clusters[0].memberNodeIds].sort()).toEqual([...ids].sort());
  expect(imported.edges[0]).toMatchObject({ source: ids[0], target: ids[1], sourceHandle: 'Long' });
  expect(imported.nodes[0].values).toEqual(nodes[0].values);
});
