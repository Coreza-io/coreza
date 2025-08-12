import { describe, test, expect } from '@jest/globals';
import { EngineV2 } from '../../coreza-backend/src/services/engineV2';
import { INodeExecutorV2, Item, WorkflowNode, NodeExecutionOutput } from '../../coreza-backend/src/nodes/types';
import { LoopExecutorV2 } from '../../coreza-backend/src/nodes/executors/LoopExecutorV2';

type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: string };

class PassExecutor implements INodeExecutorV2 {
  readonly category = 'passthrough';
  async execute(node: WorkflowNode, params: any, input: Item[]): Promise<NodeExecutionOutput> {
    return { output: input };
  }
}

describe('EngineV2 Loop re-queue behaviour', () => {
  test('processes items in batches and emits final result on done handle', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'control',
        values: { items: [{ v: 1 }, { v: 2 }, { v: 3 }], batchSize: 2, aggregate: true },
      },
      { id: 'final', type: 'noop', category: 'passthrough' },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'loop1', target: 'final', sourceHandle: 'done' },
    ];
    const engine = new EngineV2(nodes, edges as any);
    engine.registerExecutor(new LoopExecutorV2());
    engine.registerExecutor(new PassExecutor());

    await engine.run();

    expect((engine as any).nodeOutput.get('final')).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
    const state = (engine as any).nodeState;
    expect(state.get('loop1:startIndex')).toBeUndefined();
    expect(state.get('loop1:aggregation')).toBeUndefined();
  });
});
