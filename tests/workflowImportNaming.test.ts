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

it.each([null, "", 42])("rejects a malformed parent before replacing a document or allocating IDs: %p", async parentClusterId => {
  const importedFile = file([{id:"a",type:"If",position}], [], [
    {id:"11111111-1111-4111-8111-111111111111",title:"Invalid",memberNodeIds:["a"],parentClusterId},
  ]);
  await expect(importWorkflow(importedFile)).rejects.toThrow("Cluster metadata entry 1 is invalid");
});

it("rejects a file containing a parse-invalid child instead of importing a stripped parent", async () => {
  await expect(importWorkflow(file([{id:"a",type:"If",position},{id:"b",type:"If",position}], [], [
    {id:"11111111-1111-4111-8111-111111111111",title:"Outer",memberNodeIds:["a"]},
    {id:"22222222-2222-4222-8222-222222222222",title:"Inner",memberNodeIds:["b"],parentClusterId:"11111111-1111-4111-8111-111111111111",note:42},
  ]))).rejects.toThrow("Cluster metadata entry 2 is invalid");
});

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

it.each([
  { names: ['lows', 'lows1', 'lows1'] },
  { names: ['lows1', 'lows1', 'lows'] },
])('continues imported name families even when their root appears later: $names', async ({ names }) => {
  const imported = await importWorkflow(file(names.map((displayName, index) => ({ id: `id${index}`, type: 'If', displayName, position }))));
  expect(imported.nodes.map((node) => node.displayName)).toEqual(names[0] === 'lows'
    ? ['lows', 'lows1', 'lows2'] : ['lows1', 'lows2', 'lows']);
  expect(new Set(imported.nodes.map((node) => node.id)).size).toBe(3);
});
