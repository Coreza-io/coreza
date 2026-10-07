import { validateNodeClusterDocument } from './validateNodeClusters';

const nodes = [
  { id: 'a', name: 'Example', node_type: 'main', handles: [{ id: 'out', type: 'source', connectionKind: 'main' }] },
  { id: 'b', name: 'Example', node_type: 'main', handles: [{ id: 'in', type: 'target', connectionKind: 'main' }] },
];
const edges = [{ id: 'edge', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' }];
const id = '123e4567-e89b-42d3-a456-426614174000';

describe('validateNodeClusterDocument', () => {
  it('normalizes an accepted complete candidate', () => {
    expect(validateNodeClusterDocument({ nodes, edges, node_clusters: [{ id, title: ' Group ', note: ' note ', memberNodeIds: ['b', 'a'] }] }))
      .toEqual([{ id, title: 'Group', note: 'note', memberNodeIds: ['a', 'b'] }]);
  });

  it.each([
    ['duplicate-member', ['a', 'a']],
    ['missing-member', ['a', 'missing']],
  ])('rejects %s', (reason, memberNodeIds) => {
    expect(() => validateNodeClusterDocument({ nodes, edges, node_clusters: [{ id, title: 'Group', memberNodeIds }] }))
      .toThrow(reason);
  });

  it('rejects invalid canonical edges before writing', () => {
    expect(() => validateNodeClusterDocument({ nodes, edges: [{ ...edges[0], target: 'missing' }], node_clusters: [] }))
      .toThrow('invalid-edge-endpoint');
  });

  it('accepts only the supported Loop boundary topology', () => {
    const loopNodes = [
      { id: 'before', name: 'Example', node_type: 'main' },
      { id: 'loop', name: 'Loop', node_type: 'main' },
      { id: 'body', name: 'Example', node_type: 'main' },
      { id: 'after', name: 'Example', node_type: 'main' },
    ];
    const loopEdges = [
      { id: 'enter', source: 'before', target: 'loop', targetHandle: 'in' },
      { id: 'branch', source: 'loop', target: 'body', sourceHandle: 'loop' },
      { id: 'return', source: 'body', target: 'loop', targetHandle: 'in' },
      { id: 'exit', source: 'loop', target: 'after', sourceHandle: 'done' },
    ];
    expect(validateNodeClusterDocument({
      nodes: loopNodes,
      edges: loopEdges,
      node_clusters: [{ id, title: 'Loop group', memberNodeIds: ['loop', 'body'] }],
    })).toHaveLength(1);

    expect(() => validateNodeClusterDocument({
      nodes: loopNodes,
      edges: loopEdges.map((edge) => edge.id === 'exit' ? { ...edge, sourceHandle: 'loop' } : edge),
      node_clusters: [{ id, title: 'Loop group', memberNodeIds: ['loop', 'body'] }],
    })).toThrow('entry-not-root');
  });
});

it('accepts disconnected persisted members', () => {
  expect(validateNodeClusterDocument({ nodes, edges: [], node_clusters: [{ id, title: 'Group', memberNodeIds: ['a', 'b'] }] })).toHaveLength(1);
});

it('requires connectivity only when explicitly requested', () => {
  expect(() => validateNodeClusterDocument({ nodes, edges: [], node_clusters: [{ id, title: 'Group', memberNodeIds: ['a', 'b'] }] }, { requireConnectedMembers: true })).toThrow('disconnected-members');
});

import fixtures from './clusterValidationFixtures';
it.each(fixtures)('shared topology: $name', (fixture) => {
  if (fixture.valid) expect(validateNodeClusterDocument(fixture)).toHaveLength(fixture.node_clusters.length);
  else expect(() => validateNodeClusterDocument(fixture)).toThrow();
});
