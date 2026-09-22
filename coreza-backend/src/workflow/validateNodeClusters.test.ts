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
});
