import { describe, test, expect } from '@jest/globals';
import { resolveReferences as frontendResolve } from '../../src/utils/resolveReferences';
import { resolveReferences as backendResolve } from '../../coreza-backend/src/utils/resolveReferences';

describe('resolveReferences parity between frontend and backend', () => {
  const testCases = [
    {
      name: 'simple $json path',
      expr: '{{ $json.name }}',
      inputData: { name: 'Alice' },
      expected: 'Alice'
    },
    {
      name: 'nested path',
      expr: '{{ $json.user.email }}',
      inputData: { user: { email: 'test@example.com' } },
      expected: 'test@example.com'
    },
    {
      name: 'array index',
      expr: '{{ $json.items[0] }}',
      inputData: { items: ['first', 'second'] },
      expected: 'first'
    },
    {
      name: 'negative array index',
      expr: '{{ $json.items[-1] }}',
      inputData: { items: ['first', 'second', 'third'] },
      expected: 'third'
    },
    {
      name: 'slice syntax [:2]',
      expr: '{{ $json.items[:2] }}',
      inputData: { items: [1, 2, 3, 4, 5] },
      expected: JSON.stringify([1, 2])
    },
    {
      name: 'slice syntax [-3:]',
      expr: '{{ $json.items[-3:] }}',
      inputData: { items: [1, 2, 3, 4, 5] },
      expected: JSON.stringify([3, 4, 5])
    },
    {
      name: 'slice syntax [1:3]',
      expr: '{{ $json.items[1:3] }}',
      inputData: { items: ['a', 'b', 'c', 'd'] },
      expected: JSON.stringify(['b', 'c'])
    },
    {
      name: 'slice with nested path',
      expr: '{{ $json.data[:2].value }}',
      inputData: { data: [{ value: 10 }, { value: 20 }, { value: 30 }] },
      expected: JSON.stringify([10, 20])
    },
    {
      name: 'missing path returns null',
      expr: '{{ $json.missing }}',
      inputData: { name: 'test' },
      expected: 'null'
    },
    {
      name: 'object return is stringified',
      expr: '{{ $json.user }}',
      inputData: { user: { name: 'Bob', age: 30 } },
      expected: JSON.stringify({ name: 'Bob', age: 30 })
    },
    {
      name: 'node reference $("NodeName").json',
      expr: '{{ $("Node1").json.result }}',
      inputData: {},
      allNodeData: { Node1: { json: { result: 'success' } } },
      expected: 'success'
    },
    {
      name: 'node reference $node["NodeName"].json',
      expr: '{{ $node["Node2"].json.value }}',
      inputData: {},
      allNodeData: { Node2: { json: { value: 42 } } },
      expected: '42'
    },
    {
      name: 'node reference with nested output',
      expr: '{{ $("Node3").json.data[0] }}',
      inputData: {},
      allNodeData: { Node3: { output: { json: { data: ['x', 'y', 'z'] } } } },
      expected: 'x'
    },
    {
      name: 'node reference with display name',
      expr: '{{ $("My Custom Node").json.status }}',
      inputData: {},
      allNodeData: { node123: { json: { status: 'active' } } },
      nodes: [{ id: 'node123', data: { displayName: 'My Custom Node' } }],
      expected: 'active'
    },
    {
      name: 'multiple templates in one string',
      expr: 'Name: {{ $json.name }}, Age: {{ $json.age }}',
      inputData: { name: 'Charlie', age: 25 },
      expected: 'Name: Charlie, Age: 25'
    },
    {
      name: 'template with whitespace',
      expr: '{{  $json.value  }}',
      inputData: { value: 'trimmed' },
      expected: 'trimmed'
    }
  ];

  testCases.forEach(({ name, expr, inputData, allNodeData, nodes, expected }) => {
    test(`Frontend: ${name}`, () => {
      const result = frontendResolve(expr, inputData, allNodeData, nodes);
      expect(result).toBe(expected);
    });

    test(`Backend: ${name}`, () => {
      const result = backendResolve(expr, inputData, allNodeData, nodes);
      expect(result).toBe(expected);
    });

    test(`Parity: ${name}`, () => {
      const frontendResult = frontendResolve(expr, inputData, allNodeData, nodes);
      const backendResult = backendResolve(expr, inputData, allNodeData, nodes);
      expect(frontendResult).toBe(backendResult);
    });
  });

  test('Non-string input returns as-is', () => {
    const num = 123;
    expect(frontendResolve(num as any, {})).toBe(num);
    expect(backendResolve(num as any, {})).toBe(num);
  });

  test('Edge case: empty path returns full object', () => {
    const data = { x: 1, y: 2 };
    const frontendResult = frontendResolve('{{ $json }}', data);
    const backendResult = backendResolve('{{ $json }}', data);
    expect(frontendResult).toBe(JSON.stringify(data));
    expect(backendResult).toBe(JSON.stringify(data));
    expect(frontendResult).toBe(backendResult);
  });
});
