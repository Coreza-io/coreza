import type { Node, Edge } from '@xyflow/react';
import { buildLoopRegions } from '@/domain/clusters/loopRegions';
const node = (id: string, name = id): Node => ({ id, position: { x: 0, y: 0 }, data: { definition: { name, node_type: 'main', handles: [{ id: 'loop', type: 'source', connectionKind: 'main' }, { id: 'done', type: 'source', connectionKind: 'main' }] } } });
const edge = (source: string, target: string, sourceHandle?: string): Edge => ({ id: `${source}-${target}`, source, target, sourceHandle });
const regions = (nodes: Node[], edges: Edge[]) => buildLoopRegions({ memberNodeIds: nodes.map(n => n.id), executableNodeIds: nodes.map(n => n.id) }, edges, new Map(nodes.map(n => [n.id, n])), new Set(nodes.map(n => n.id)));
it('keeps only paths that lead back to the Loop in plan order', () => {
  const result = regions([node('loop', 'Loop'), node('body'), node('tail'), node('done'), node('side')], [edge('loop', 'body', 'loop'), edge('body', 'tail'), edge('tail', 'loop'), edge('loop', 'done', 'done'), edge('body', 'side')]);
  expect(result[0]).toEqual({ loopNodeId: 'loop', bodyNodeIds: ['body', 'tail'], feedbackEdgeIds: ['tail-loop'], doneStartNodeIds: ['done'] });
});
it('rejects a branch without feedback', () => {
  expect(() => regions([node('loop', 'Loop'), node('body')], [edge('loop', 'body', 'loop')])).toThrow('feedback');
});
it('rejects body nodes on the done side', () => {
  expect(() => regions([node('loop', 'Loop'), node('body'), node('done')], [edge('loop', 'body', 'loop'), edge('body', 'loop'), edge('loop', 'done', 'done'), edge('done', 'body')])).toThrow('done side');
});
it('accepts sequential Loops', () => {
  expect(regions([node('l1', 'Loop'), node('b1'), node('l2', 'Loop'), node('b2'), node('done')], [edge('l1', 'b1', 'loop'), edge('b1', 'l1'), edge('l1', 'l2', 'done'), edge('l2', 'b2', 'loop'), edge('b2', 'l2'), edge('l2', 'done', 'done')])).toHaveLength(2);
});
it('rejects overlapping bodies', () => {
  expect(() => regions([node('l1', 'Loop'), node('l2', 'Loop'), node('body')], [edge('l1', 'body', 'loop'), edge('l2', 'body', 'loop'), edge('body', 'l1'), edge('body', 'l2')])).toThrow('Overlapping');
});
it('rejects nested Loops', () => {
  expect(() => regions([node('outer', 'Loop'), node('inner', 'Loop'), node('body'), node('tail')], [edge('outer', 'inner', 'loop'), edge('inner', 'body', 'loop'), edge('body', 'inner'), edge('inner', 'tail', 'done'), edge('tail', 'outer')])).toThrow('nested');
});
