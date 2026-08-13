import { describe, expect, jest, test } from '@jest/globals';
import {
  MAX_PINNED_OUTPUT_BYTES,
  safePinnedOutput,
} from '../../src/utils/pinnedOutput';

describe('safePinnedOutput', () => {
  test('preserves serializable values within the size limit', () => {
    const value = { result: [1, 2, 3] };
    expect(safePinnedOutput(value)).toBe(value);
  });

  test('drops oversized and circular values', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(safePinnedOutput('x'.repeat(MAX_PINNED_OUTPUT_BYTES))).toBeUndefined();
    expect(safePinnedOutput(circular)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});
