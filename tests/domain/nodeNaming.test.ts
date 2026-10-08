jest.mock("@/nodes/manifest", () => ({ nodeManifest: {
  Loop: { name: "Loop", node_type: "main", category: "logic" },
  If: { name: "If", node_type: "main", category: "logic" },
} }));
import { allocateNodeName, nodeDisplayName } from '../../src/domain/nodeNaming';
import { buildNodeReference, createJsonReferenceDragPayload } from '../../src/utils/referencePath';
import { resolveNodeAlias, resolveNodeKey, withUniqueInstanceAliases } from '../../src/utils/referenceResolution';
import { remapNodeReferenceMap } from '../../src/utils/remapNodeReferences';
import { resolveReferences } from '../../src/utils/resolveReferences';
import { resolveNodeRename } from '../../src/domain/clusters/nodeRename';
import { pasteNodesInDocument, renameNodeInDocument } from '../../src/domain/clusters/documentCommands';
import { importWorkflow } from '../../src/utils/workflowExport';
import { serializeWorkflowContent } from '../../src/domain/workflowDocument';
import { buildPreviewData } from '../../src/utils/previewDataResolver';
import { ExecutionContext } from '../../src/utils/executionContext';
import { ParameterResolver } from '../../coreza-backend/src/engine/parameterResolver';
import type { Node } from '@xyflow/react';

const node = (id: string, displayName?: string): Node => ({ id, position: { x: 0, y: 0 }, data: { displayName } });

describe('canonical node naming and references', () => {
  it('reserves hidden IDs, trimmed case-insensitive aliases, and earlier batch names without renumbering', () => {
    const nodes = [node('Loop'), node('Loop2'), node('hidden', ' loop1 ')];
    expect(allocateNodeName('Loop', nodes)).toEqual({ ok: true, name: 'Loop3' });
    expect(allocateNodeName('Loop', nodes.slice(1))).toEqual({ ok: true, name: 'Loop' });
    expect(nodeDisplayName(nodes[1])).toBe('Loop2');
    expect(allocateNodeName('Strategy2026', [node('Strategy2026')])).toEqual({ ok: true, name: 'Strategy20261' });
    expect(allocateNodeName('Loop', [], undefined, new Set(['Loop', 'loop1']))).toEqual({ ok: true, name: 'Loop2' });
    expect(allocateNodeName('__CLUSTER__1', [])).toMatchObject({ ok: false, code: 'reserved' });
  });

  it('continues an existing numbered family across repeated copies and batch reservations', () => {
    const nodes = [node('lows'), node('lows1')];
    const reservations = new Set<string>();
    for (const expected of ['lows2', 'lows3', 'lows4']) {
      const result = allocateNodeName('lows1', nodes, undefined, reservations);
      expect(result).toEqual({ ok: true, name: expected });
      if (result.ok) reservations.add(result.name);
    }
    expect(allocateNodeName('lows3', [node('lows'), node('lows1'), node('lows3')])).toEqual({ ok: true, name: 'lows2' });
    expect(allocateNodeName('lows7', nodes)).toEqual({ ok: true, name: 'lows7' });
    expect(resolveNodeRename('lows1', 'lows', nodes)).toEqual({ ok: true, name: 'lows2', changed: true });
    expect(allocateNodeName('lows1', [node('lows1')], undefined, new Set(), ['lows', 'lows1'])).toEqual({ ok: true, name: 'lows2' });
    expect(allocateNodeName('LOWS1', [node('uuid', ' lows '), node('hidden', 'lows1')])).toEqual({ ok: true, name: 'LOWS2' });
    expect(allocateNodeName('Strategy2026', [node('Strategy2026')])).toEqual({ ok: true, name: 'Strategy20261' });
  });

  it('pastes a numbered copy with remapped internal references and unchanged external references', () => {
    const nodes = [node('lows'), node('lows1')];
    nodes[1].data.values = { self: `{{ $('lows1').json.marker }}`, external: `{{ $('lows').json.marker }}` };
    const allocated = allocateNodeName(nodeDisplayName(nodes[1]), nodes);
    expect(allocated).toEqual({ ok: true, name: 'lows2' });
    if (!allocated.ok) return;
    const copy = { ...nodes[1], id: allocated.name, data: { ...nodes[1].data, displayName: allocated.name } };
    const pasted = pasteNodesInDocument({ nodes, edges: [], clusters: [] }, {
      nodes: [copy], idMap: { lows1: allocated.name }, sourceNodes: nodes, copiedClusters: [],
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(pasted.document.nodes.map(nodeDisplayName)).toEqual(['lows', 'lows1', 'lows2']);
    expect(pasted.document.nodes[2].data.values).toEqual({ self: `{{ $('lows2').json.marker }}`, external: `{{ $('lows').json.marker }}` });
    expect(nodes[1].data.values).toEqual({ self: `{{ $('lows1').json.marker }}`, external: `{{ $('lows').json.marker }}` });
  });

  it('renames the screenshot case through topology, references, runtime, history and saved content', () => {
    const nodes = [node('lows'), node('lows1'), node('lows11')];
    nodes[1].data.values = { expression: `{{ $('lows11').json.marker }}` };
    nodes[2].data.fieldState = { expression: `{{ $node['lows11'].json.marker }}` };
    const current = {
      nodes,
      edges: [{ id: 'edge', source: 'lows11', target: 'lows1' }],
      clusters: [{ id: '00000000-0000-4000-8000-000000000001', title: 'Cluster', memberNodeIds: ['lows11', 'lows1'] }],
    };
    const result = resolveNodeRename('lows1', 'lows11', nodes);
    expect(result).toEqual({ ok: true, name: 'lows2', changed: true });
    if (!result.ok) return;
    const renamed = renameNodeInDocument(current, 'lows11', result.name).document;
    const runtime = new ExecutionContext();
    runtime.setPinned('lows11', { marker: 42 });
    runtime.renameNode('lows11', result.name);
    const preview = buildPreviewData(renamed.nodes, runtime, () => renamed.nodes);
    expect(renamed.nodes.map(nodeDisplayName)).toEqual(['lows', 'lows1', 'lows2']);
    expect(renamed.edges[0]).toMatchObject({ id: 'edge', source: 'lows2', target: 'lows1' });
    expect(renamed.clusters[0].memberNodeIds).toEqual(['lows2', 'lows1']);
    expect(renamed.nodes[2].data.fieldState).toEqual({ expression: `{{ $node['lows2'].json.marker }}` });
    expect(resolveReferences((renamed.nodes[1].data.values as { expression: string }).expression, {}, preview.allNodeData, renamed.nodes)).toBe(42);
    expect(runtime.storeMap.has('lows11')).toBe(false);
    expect(serializeWorkflowContent('workflow', null, renamed.nodes, renamed.edges, renamed.clusters).nodes[2]).toMatchObject({ id: 'lows2', displayName: 'lows2' });
    expect(buildNodeReference(createJsonReferenceDragPayload(['marker'], 'lows2', ''), renamed.nodes)).toBe('{{ $("lows2").json.marker }}');
    // Undo/redo restores committed names and moves pinned state without allocating again.
    runtime.renameNode('lows2', 'lows11');
    expect(current.nodes.map(nodeDisplayName)).toEqual(['lows', 'lows1', 'lows11']);
    runtime.renameNode('lows11', 'lows2');
    expect(runtime.getNodeData('lows2').output).toEqual({ marker: 42 });
    expect(resolveNodeRename('lows2', 'lows2', renamed.nodes)).toEqual({ ok: true, name: 'lows2', changed: false });
  });

  it('checks truncated suffix candidates and preserves the manual length limit', () => {
    const base = 'a'.repeat(50);
    expect(allocateNodeName(base, [node(base), node('a'.repeat(49) + '1')])).toEqual({ ok: true, name: 'a'.repeat(49) + '2' });
    expect(allocateNodeName(base + 'a', [])).toMatchObject({ ok: false, code: 'too-long' });
  });

  it('builds canonical selectors and rejects explicitly stale drag sources', () => {
    const payload = createJsonReferenceDragPayload(['data', 'Item', 0], 'Loop3', '');
    expect(buildNodeReference(payload, [node('Loop3', 'Legacy')])).toBe('{{ $("Loop3").json.data.Item[0] }}');
    expect(buildNodeReference(payload, [node('Loop')], 'Loop')).toBeNull();
    expect(buildNodeReference({ ...payload, sourceNodeId: undefined }, [node('Loop')], 'Loop')).toBe('{{ $("Loop").json.data.Item[0] }}');
    expect(buildNodeReference({ ...payload, sourceNodeId: '__cluster__1' }, [node('__cluster__1')])).toBeNull();
  });

  it('gives exact IDs precedence and never substitutes alias output when the ID has no output', () => {
    const nodes = [node('other', 'Loop'), node('Loop')];
    expect(resolveNodeAlias('Loop', nodes)).toBe('Loop');
    expect(resolveNodeKey('Loop', { other: { value: 1 } }, nodes)).toBeUndefined();
    expect(resolveReferences('{{ $("Loop").json.value }}', {}, { other: { value: 1 } }, nodes)).toBeUndefined();
    expect(resolveReferences('{{ $("Loop").json }}', {}, { Loop: false }, nodes)).toBe(false);
  });

  it('rejects ambiguous aliases even when alias-keyed data exists', () => {
    const nodes = [node('a', 'Legacy'), node('b', 'Legacy')];
    expect(() => resolveReferences('{{ $("Legacy").json }}', {}, { Legacy: 1, a: 2 }, nodes)).toThrow('Ambiguous node reference');
    expect(resolveNodeAlias('Legacy', [node('a', 'Legacy'), { id: 'b', name: 'Legacy' }])).toBe('a');
  });

  it('propagates alias ambiguity through compiled and fallback backend parameter resolution', () => {
    const nodes = [
      { id: 'a', name: 'Loop', displayName: 'Legacy', node_type: 'main', category: 'logic' },
      { id: 'b', name: 'Loop', displayName: 'Legacy', node_type: 'main', category: 'logic' },
      { id: 'consumer', name: 'If', node_type: 'main', category: 'logic', values: { value: '{{ $("Legacy").json }}' } },
    ];
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resolver = new ParameterResolver(nodes);
      expect(() => resolver.resolve(nodes[2], {}, () => ({ a: 1, b: 2 }))).toThrow('Ambiguous node reference');
    } finally { warning.mockRestore(); }
  });

  it('remaps simultaneously, preserves external selectors, and excludes aliases belonging to other exact IDs', () => {
    const nodes = [node('a', 'b'), node('b', 'Legacy')];
    const names = withUniqueInstanceAliases({ a: 'b', b: 'c' }, nodes);
    expect(names).toEqual({ a: 'b', b: 'c', Legacy: 'c' });
    expect(remapNodeReferenceMap(`{{ $('a').json }} {{ $node['b'].json }} {{ $("outside").json }}`, names))
      .toBe(`{{ $('b').json }} {{ $node['c'].json }} {{ $("outside").json }}`);
    expect(remapNodeReferenceMap('{{ $(' + JSON.stringify('a"b') + ').json }}', { 'a"b': 'next' })).toBe('{{ $("next").json }}');
  });

  it('keys previews by ID and preserves false, zero, empty and pinned outputs', () => {
    const nodes = [node('a', 'same'), node('b', 'same'), node('c'), node('d')];
    nodes[0].data.output = false;
    nodes[1].data.output = 0;
    nodes[2].data.output = '';
    nodes[3].data.pinnedOutput = [];
    const store = new ExecutionContext();
    const preview = buildPreviewData(nodes, store, () => nodes);
    expect(preview.allNodeData).toEqual({ a: false, b: 0, c: '', d: [] });
    expect(preview.getSourceData('a')).toBe(false);
    store.setNodeData('a', { output: 'live' });
    expect(preview.getSourceData('a')).toBe('live');
  });

  it('renames a proven explicit alias with the transaction without touching output or metadata', () => {
    const source = node('a', 'Legacy');
    const consumer = node('b');
    consumer.data = { values: { expression: '{{ $("Legacy").json }}' }, output: '{{ $("a").json }}' };
    const current = { nodes: [source, consumer], edges: [], clusters: [] };
    const renamed = renameNodeInDocument(current, 'a', 'next').document;
    expect(renamed.nodes[1].data.values).toEqual({ expression: '{{ $("next").json }}' });
    expect(renamed.nodes[1].data.output).toBe('{{ $("a").json }}');
    expect(current.nodes[0].id).toBe('a');
    expect(serializeWorkflowContent('workflow', null, renamed.nodes, [], []).nodes[0].displayName).toBe('next');
  });

  it('imports fresh identities and remaps topology and proven aliases while retaining public names', async () => {
    const data = { meta: { source: 'coreza' }, name: 'workflow', nodes: [
      { id: 'Loop', type: 'Loop', displayName: 'Legacy', position: { x: 0, y: 0 } },
      { id: 'If', type: 'If', position: { x: 1, y: 1 }, values: { value: '{{ $("Legacy").json.data.Item[0] }}' } },
    ], edges: [{ id: 'edge', source: 'Loop', target: 'If' }] };
    const imported = await importWorkflow({ text: async () => JSON.stringify(data) } as File);
    expect(imported.nodes[0].id).not.toBe('Loop');
    expect(imported.nodes[0].displayName).toBe('Legacy');
    expect(imported.nodes[1].values?.value).toBe(`{{ $("${imported.nodes[0].id}").json.data.Item[0] }}`);
    expect(imported.edges[0]).toMatchObject({ source: imported.nodes[0].id, target: imported.nodes[1].id });
    expect(imported.edges[0].id).not.toBe('edge');
    await expect(importWorkflow({ text: async () => JSON.stringify({ ...data, nodes: [data.nodes[0], data.nodes[0]] }) } as File)).rejects.toThrow('duplicate node IDs');
  });
});
