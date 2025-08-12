import { describe, expect, test } from '@jest/globals';
import { EngineV2 } from '../../coreza-backend/src/services/engineV2';
import { INodeExecutorV2, Item, WorkflowNode, NodeExecutionOutput } from '../../coreza-backend/src/nodes/types';
import { ComparatorService } from '../../coreza-backend/src/services/comparator';

type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: string };

class IfExecutor implements INodeExecutorV2 {
  readonly category = 'control';
  async execute(node: WorkflowNode, params: any, input: Item[]): Promise<NodeExecutionOutput> {
    const { left, operator, right } = params;
    const { trueItems, falseItems } = await ComparatorService.evaluateIfItems(input, { left, operator, right });
    return { output: [], trueItems, falseItems };
  }
}

class PassExecutor implements INodeExecutorV2 {
  readonly category = 'passthrough';
  async execute(node: WorkflowNode, params: any, input: Item[]): Promise<NodeExecutionOutput> {
    return { output: input };
  }
}

describe('ComparatorService.evaluateIfItems', () => {
  test('splits items correctly', async () => {
    const items = [{ value: 1 }, { value: 2 }];
    const { trueItems, falseItems } = await ComparatorService.evaluateIfItems(items, {
      left: 'value',
      operator: '>',
      right: 1,
    });
    expect(trueItems).toEqual([{ value: 2 }]);
    expect(falseItems).toEqual([{ value: 1 }]);
  });
});

describe('EngineV2 IF branching', () => {
  test('routes items to true and false branches', async () => {
    const nodes: WorkflowNode[] = [
      { id: 'if1', type: 'If', category: 'control', values: { left: 'value', operator: '>', right: 5 } },
      { id: 'trueNode', type: 'noop', category: 'passthrough' },
      { id: 'falseNode', type: 'noop', category: 'passthrough' },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'if1', target: 'trueNode', sourceHandle: 'true' },
      { id: 'e2', source: 'if1', target: 'falseNode', sourceHandle: 'false' },
    ];
    const engine = new EngineV2(nodes, edges as any);
    engine.registerExecutor(new IfExecutor());
    engine.registerExecutor(new PassExecutor());

    await engine.run([{ value: 7 }, { value: 3 }]);

    expect((engine as any).nodeOutput.get('trueNode')).toEqual([{ value: 7 }]);
    expect((engine as any).nodeOutput.get('falseNode')).toEqual([{ value: 3 }]);
  });
});
