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
