import { describe, expect, test } from '@jest/globals';
import ExecutionContext from '../../src/utils/executionContext';

describe('ExecutionContext pinned output', () => {
  test('rejects output writes while accepting other state updates', () => {
    const ctx = new ExecutionContext();
    const pinnedOutput = { hardcoded: true };

    ctx.setPinned('node', pinnedOutput);
    ctx.setNodeData('node', { output: { socket: true }, isListening: false });

    expect(ctx.getNodeData('node')).toEqual({
      output: pinnedOutput,
      isListening: false,
    });

    ctx.setPinned('node', null);
    ctx.setNodeData('node', { output: { socket: true } });
    expect(ctx.getNodeData('node').output).toEqual({ socket: true });
  });

  it('moves execution data and pinned output atomically during rename', () => {
    const ctx = new ExecutionContext();
    ctx.setNodeData('OnBar', { input: 0, output: false, isListening: false });
    ctx.setPinned('OnBar', 0);

    ctx.renameNode('OnBar', 'Test');

    expect(ctx.storeMap.has('OnBar')).toBe(false);
    expect(ctx.getNodeData('Test')).toMatchObject({ input: 0, output: 0, isListening: false });
    ctx.setNodeData('Test', { output: 99 });
    expect(ctx.getNodeData('Test').output).toBe(0);
  });

  it('rejects a rename destination that already has runtime data', () => {
    const ctx = new ExecutionContext();
    ctx.setNodeData('a', { output: 1 });
    ctx.setNodeData('b', { output: 2 });
    expect(() => ctx.renameNode('a', 'b')).toThrow('already exists');
    expect(ctx.getNodeData('a').output).toBe(1);
    expect(ctx.getNodeData('b').output).toBe(2);
  });

  test('keeps pinned outputs when runtime state is cleared', () => {
    const ctx = new ExecutionContext();
    const pinnedOutput = { hardcoded: true };

    ctx.setPinned('node', pinnedOutput);
    ctx.setNodeData('other', { output: { transient: true } });
    ctx.clear();

    expect(ctx.getNodeData('node').output).toBe(pinnedOutput);
    expect(ctx.getNodeData('other').output).toBeUndefined();

    ctx.setNodeData('node', {
      output: { socket: true },
      isTestListening: true,
    });
    expect(ctx.getNodeData('node')).toEqual({
      output: pinnedOutput,
      isTestListening: true,
    });
  });
});
