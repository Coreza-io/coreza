import { validateExpressionDocument } from './expressionDocument';
import type { WorkflowNode } from '../nodes/types';
const node: WorkflowNode = { id: 'n', name: 'Compute', node_type: 'main', category: 'Logic', values: { __expressionFormatVersion: 1, value: '{{ $json.count }}' }, data: { definition: { fields: [{ key: 'value', type: 'number' }] } } };
test('retained nodes cannot lose their dialect through alternate writers', () => {
  expect(() => validateExpressionDocument([{ ...node, values: { value: 1 } }], [node])).toThrow('expression-writer-upgrade-required');
  expect(() => validateExpressionDocument([], [node])).not.toThrow();
  expect(() => validateExpressionDocument([node], [node])).not.toThrow();
});
test('new dialect syntax and unsupported versions fail before storage', () => {
  expect(() => validateExpressionDocument([{ ...node, values: { __expressionFormatVersion: 2 } }])).toThrow('Unsupported expression dialect');
  expect(() => validateExpressionDocument([{ ...node, values: { __expressionFormatVersion: 1, value: '{{' } }])).toThrow('Unclosed');
});
