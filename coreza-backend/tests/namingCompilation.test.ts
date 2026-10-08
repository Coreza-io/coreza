import { preCompileAllNodes, compileParamsToSlots } from '../src/utils/templateCompiler';
import { compilePlan } from '../src/backtest/compiled/compiler';
import { GraphRuntime } from '../src/engine/graphRuntime';
import { ParameterResolver } from '../src/engine/parameterResolver';
import type { WorkflowNode, INodeExecutor } from '../src/nodes/types';

it('rejects a compiled backtest after ambiguous parameter compilation and preserves runtime diagnostics', () => {
  const nodes: WorkflowNode[] = [
    { id: 'a', name: 'Compute', displayName: 'Legacy', node_type: 'main', category: 'Logic' },
    { id: 'b', name: 'Compute', displayName: 'Legacy', node_type: 'main', category: 'Logic' },
    { id: 'consumer', name: 'Compute', node_type: 'main', category: 'Logic', values: { value: `{{ $('Legacy').json.marker }}`, threshold: 42 } },
  ];
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const compiled = preCompileAllNodes(nodes);
    expect(compiled.has('consumer')).toBe(false);
    const executor: INodeExecutor = { category: 'Logic', syncCapable: true, execute: () => ({ success: true, data: {} }) };
    const plan = compilePlan(new GraphRuntime(nodes, []), new Map(nodes.map((node) => [node.id, executor])), ['a', 'b', 'consumer'], compiled, {}, {
      runId: 'test', workflowId: 'test', userId: 'test', nodes, edges: [], dataContext: {}, indicatorStateManager: {}, storeGetState: () => undefined, storeSetState: () => {},
    });
    expect(plan).toBeNull();
    const resolver = new ParameterResolver(nodes);
    expect(() => resolver.resolve(nodes[2], {}, () => ({ a: { marker: 1 }, b: { marker: 2 } })))
      .toThrow('Ambiguous node reference "Legacy"');
  } finally {
    warning.mockRestore();
    log.mockRestore();
  }
});

it('keeps successfully compiled empty and static parameters eligible', () => {
  expect(compileParamsToSlots(null, new Map())).toBeNull();
  expect(compileParamsToSlots({ hasTemplates: false, staticParams: {} }, new Map())?.([])).toEqual({});
  expect(compileParamsToSlots({ hasTemplates: false, staticParams: { threshold: 42 } }, new Map())?.([]))
    .toEqual({ threshold: 42 });
});
