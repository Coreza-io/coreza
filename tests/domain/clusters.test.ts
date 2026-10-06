import type { Edge, Node } from '@xyflow/react';
import { normalizeClusters, validateClusterSelection, validateClusters } from '../../src/domain/clusters/validate';
import type { NodeCluster } from '../../src/domain/clusters/types';
import { parseNodeClusters } from '../../src/domain/clusters/parse';

const node = (id: string, nodeType = 'main'): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    definition: {
      name: id,
      node_type: nodeType,
      handles: [
        { id: 'input', type: 'target' },
        { id: 'output', type: 'source' },
      ],
    },
  },
});
const edge = (id: string, source: string, target: string, handles: Partial<Edge> = {}): Edge => ({ id, source, target, ...handles });
const cluster = (memberNodeIds: string[], overrides: Partial<NodeCluster> = {}): NodeCluster => ({
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Cluster 1',
  memberNodeIds,
  ...overrides,
});

describe('cluster validation', () => {
  it('accepts a connected single-entry, single-exit cluster', () => {
    const nodes = ['outside-in', 'a', 'b', 'outside-out'].map((id) => node(id));
    const edges = [edge('in', 'outside-in', 'a'), edge('inner', 'a', 'b'), edge('out', 'b', 'outside-out')];
    expect(validateClusters(nodes, edges, [cluster(['a', 'b'])])).toEqual({ valid: true, violations: [] });
  });

  it('reports stable reason codes and implicated nodes for invalid boundaries', () => {
    const nodes = ['x', 'a', 'b', 'y'].map((id) => node(id));
    const result = validateClusters(nodes, [edge('one', 'x', 'a'), edge('two', 'x', 'b'), edge('inner', 'a', 'b'), edge('out', 'a', 'y')], [cluster(['a', 'b'])]);
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'multiple-entry-members', nodeIds: ['a', 'b'] }),
      expect.objectContaining({ code: 'exit-not-leaf', nodeIds: ['a'] }),
    ]));
  });

  it('rejects trigger, overlap, missing member, and crossing attachment metadata', () => {
    const model = node('model', 'sub');
    model.data.definition = {
      ...(model.data.definition as object),
      handles: [{ id: 'chatModel', type: 'source', connectionKind: 'attachment' }],
    };
    const agent = node('a');
    agent.data.definition = {
      ...(agent.data.definition as object),
      handles: [{ id: 'chatModel', type: 'target', connectionKind: 'attachment' }],
    };
    const nodes = [node('trigger', 'trigger'), agent, model];
    const clusters = [cluster(['trigger', 'a', 'missing']), cluster(['a'], { id: '00000000-0000-4000-8000-000000000002', title: 'Cluster 2' })];
    const result = validateClusters(nodes, [edge('attachment', 'model', 'a', { sourceHandle: 'chatModel', targetHandle: 'chatModel' })], clusters);
    expect(result.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'trigger-member', 'missing-member', 'overlapping-membership', 'attachment-boundary',
    ]));
  });

  it('requires two nodes only when creating a cluster', () => {
    const candidate = cluster([]);
    expect(validateClusterSelection(['a'], [node('a')], [], [], candidate).violations[0].code).toBe('too-few-members');
    expect(validateClusters([node('a')], [], [cluster(['a'])]).valid).toBe(true);
  });

  it('allows persisted unwired members while requiring connected initial selections', () => {
    const nodes = [node('a'), node('b'), node('unwired')];
    expect(validateClusters(nodes, [edge('ab', 'a', 'b')], [cluster(['a', 'b', 'unwired'])]).valid).toBe(true);
    const selection = validateClusterSelection(['a', 'unwired'], nodes, [edge('ab', 'a', 'b')], [], cluster([]));
    expect(selection.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'disconnected-members' }),
    ]));
  });

  it('normalizes titles, notes, membership order, and duplicates', () => {
    expect(normalizeClusters([cluster(['b', 'a', 'b'], { title: ' Cluster 1 ', note: ' note ' })])[0]).toMatchObject({
      title: 'Cluster 1', note: 'note', memberNodeIds: ['a', 'b'],
    });
  });

  it('does not coerce malformed persisted metadata', () => {
    expect(parseNodeClusters([{ id: 'id', title: 'Title', memberNodeIds: [42] }])).toEqual({
      clusters: [],
      invalidIndexes: [0],
      invalidEntries: [{ index: 0, value: { id: 'id', title: 'Title', memberNodeIds: [42] } }],
    });
  });

  it('uses node_type rather than display names to identify triggers', () => {
    expect(validateClusters([node('Scheduler', 'trigger')], [], [cluster(['Scheduler'])]).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'trigger-member' })]));
  });

  it('expands required attachments and returns the resolved membership', () => {
    const model = node('model', 'sub');
    model.data.definition = {
      ...(model.data.definition as object),
      handles: [{ id: 'chatModel', type: 'source', connectionKind: 'attachment' }],
    };
    const agent = node('agent');
    agent.data.definition = {
      ...(agent.data.definition as object),
      handles: [
        { id: 'input', type: 'target' },
        { id: 'chatModel', type: 'target', connectionKind: 'attachment' },
      ],
    };
    const result = validateClusterSelection(
      ['agent', 'action'],
      [model, agent, node('action')],
      [
        edge('attachment', 'model', 'agent', { sourceHandle: 'chatModel', targetHandle: 'chatModel' }),
        edge('main', 'agent', 'action'),
      ],
      [],
      cluster([]),
    );

    expect(result.valid).toBe(true);
    expect(result.resolvedMemberNodeIds).toEqual(expect.arrayContaining(['model', 'agent', 'action']));
  });

  it('rejects an attachment shared with an owner outside the selection', () => {
    const model = node('model', 'sub');
    model.data.definition = {
      ...(model.data.definition as object),
      handles: [{ id: 'chatModel', type: 'source', connectionKind: 'attachment' }],
    };
    const agents = ['agent-a', 'agent-b'].map((id) => {
      const agent = node(id);
      agent.data.definition = {
        ...(agent.data.definition as object),
        handles: [{ id: 'chatModel', type: 'target', connectionKind: 'attachment' }],
      };
      return agent;
    });
    const result = validateClusterSelection(
      ['agent-a', 'action'],
      [model, ...agents, node('action')],
      [
        edge('model-a', 'model', 'agent-a', { sourceHandle: 'chatModel', targetHandle: 'chatModel' }),
        edge('model-b', 'model', 'agent-b', { sourceHandle: 'chatModel', targetHandle: 'chatModel' }),
        edge('main', 'agent-a', 'action'),
      ],
      [],
      cluster([]),
    );

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'shared-attachment', nodeIds: ['model', 'agent-b'] }),
    ]));
  });

  it('rejects a directly selected shared attachment without adding its owners', () => {
    const model = node('model', 'sub');
    model.data.definition = { ...(model.data.definition as object), handles: [{ id: 'chatModel', type: 'source', connectionKind: 'attachment' }] };
    const agents = ['agent-a', 'agent-b'].map((id) => {
      const owner = node(id);
      owner.data.definition = { ...(owner.data.definition as object), handles: [{ id: 'chatModel', type: 'target', connectionKind: 'attachment' }] };
      return owner;
    });
    const result = validateClusterSelection(
      ['model', 'action'], [model, ...agents, node('action')],
      [
        edge('owner-a', 'model', 'agent-a', { sourceHandle: 'chatModel', targetHandle: 'chatModel' }),
        edge('owner-b', 'model', 'agent-b', { sourceHandle: 'chatModel', targetHandle: 'chatModel' }),
        edge('main', 'model', 'action'),
      ], [], cluster([]),
    );
    expect(result.valid).toBe(false);
    expect(result.resolvedMemberNodeIds).toEqual(expect.arrayContaining(['model', 'action']));
    expect(result.resolvedMemberNodeIds).not.toEqual(expect.arrayContaining(['agent-a', 'agent-b']));
    expect(result.violations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'shared-attachment' })]));
  });

  it('does not interpret an unknown supplied handle as main flow', () => {
    const result = validateClusters(
      [node('a'), node('b')],
      [edge('bad-handle', 'a', 'b', { sourceHandle: 'misspelled', targetHandle: 'input' })],
      [cluster(['a', 'b'])],
    );
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown-semantics', edgeIds: ['bad-handle'] }),
    ]));
  });

  it('accepts a configured dynamic Switch handle and rejects a removed one', () => {
    const switchNode = node('switch');
    switchNode.data.definition = {
      name: 'Switch', node_type: 'main',
      handles: [{ id: 'input', type: 'target' }, { id: 'fallback', type: 'source' }],
    };
    switchNode.data.values = { cases: [{ outputName: 'winner' }], enableFallback: true };
    const nodes = [switchNode, node('target')];
    expect(validateClusters(nodes, [edge('valid', 'switch', 'target', { sourceHandle: 'winner', targetHandle: 'input' })], [cluster(['switch', 'target'])]).valid).toBe(true);
    expect(validateClusters(nodes, [edge('removed', 'switch', 'target', { sourceHandle: 'old-branch', targetHandle: 'input' })], [cluster(['switch', 'target'])]).violations)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-semantics', edgeIds: ['removed'] })]));
  });

  it('accepts only the explicit Loop loop/in cycle with a done boundary', () => {
    const loop = node('loop');
    loop.data.definition = {
      name: 'Loop', node_type: 'main',
      handles: [{ id: 'in', type: 'target' }, { id: 'loop', type: 'source' }, { id: 'done', type: 'source' }],
    };
    const nodes = [node('before'), loop, node('body'), node('after')];
    const edges = [
      edge('incoming', 'before', 'loop', { sourceHandle: 'output', targetHandle: 'in' }),
      edge('branch', 'loop', 'body', { sourceHandle: 'loop', targetHandle: 'input' }),
      edge('return', 'body', 'loop', { sourceHandle: 'output', targetHandle: 'in' }),
      edge('done', 'loop', 'after', { sourceHandle: 'done', targetHandle: 'input' }),
    ];
    expect(validateClusters(nodes, edges, [cluster(['loop', 'body'])]).valid).toBe(true);
    const arbitraryCycle = edges.map((item) => item.id === 'done' ? { ...item, sourceHandle: 'loop' } : item);
    expect(validateClusters(nodes, arbitraryCycle, [cluster(['loop', 'body'])]).valid).toBe(false);
  });
});
