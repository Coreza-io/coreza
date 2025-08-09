import { describe, test, expect } from '@jest/globals';
import ExecutionContext from '../../src/utils/executionContext';

describe('ExecutionContext loop helpers', () => {
  test('items mode advances and aggregates', () => {
    const ctx = new ExecutionContext();
    ctx.startLoop('loop', [0,1,2,3,4], { batchSize: 2 });

    ctx.advanceLoop('loop', [0,1], 2, false);
    let st = ctx.getNodeData('loop');
    expect(st.loopIndex).toBe(2);
    expect(st.aggregated).toEqual([0,1]);
    expect(st.output).toEqual([0,1]);
    expect(st.done).toBe(false);

    ctx.advanceLoop('loop', [2,3], 4, false);
    st = ctx.getNodeData('loop');
    expect(st.loopIndex).toBe(4);
    expect(st.aggregated).toEqual([0,1,2,3]);
    expect(st.output).toEqual([2,3]);
    expect(st.done).toBe(false);

    ctx.advanceLoop('loop', [4], 5, true);
    st = ctx.getNodeData('loop');
    expect(st.loopIndex).toBe(5);
    expect(st.aggregated).toEqual([0,1,2,3,4]);
    expect(st.output).toEqual([0,1,2,3,4]);
    expect(st.done).toBe(true);
    expect(st.loopItems).toBeUndefined();
    expect(st.loopItem).toBeUndefined();
  });

  test('returns mode aggregates outputs from returners after loop finish', () => {
    const ctx = new ExecutionContext();
    ctx.startLoop('loop', [1,2], { aggregateMode: 'returns', returnSources: ['A','B'] });

    ctx.appendLoopReturn('loop', 'A', 'resA');
    let st = ctx.getNodeData('loop');
    expect(st.aggregated).toEqual(['resA']);
    expect(st.output).toBeUndefined();
    expect(st.done).toBe(false);

    ctx.setNodeData('loop', { finishedByLoop: true });
    ctx.appendLoopReturn('loop', 'B', 'resB');
    st = ctx.getNodeData('loop');
    expect(st.aggregated).toEqual(['resA','resB']);
    expect(st.output).toEqual(['resA','resB']);
    expect(st.done).toBe(true);
  });
});
