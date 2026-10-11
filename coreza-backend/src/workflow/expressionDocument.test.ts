import { validateExpressionDocument } from './expressionDocument';
import type { WorkflowNode } from '../nodes/types';
import { WorkflowQueryService } from './WorkflowQueryService';
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

test('authoring capability requires writer readiness and respects reader-only rollback', async () => {
  const previous = process.env.COREZA_EXPRESSION_AUTHORING;
  const expressionReady = jest.fn().mockResolvedValue(false);
  const query = new WorkflowQueryService({ hierarchyReady: async () => true, expressionReady } as any, {} as any, {} as any);
  try {
    delete process.env.COREZA_EXPRESSION_AUTHORING;
    expect((await query.getCapabilities()).expression_format_version).toBe(0);
    expressionReady.mockResolvedValue(true);
    expect((await query.getCapabilities()).expression_format_version).toBe(1);
    process.env.COREZA_EXPRESSION_AUTHORING = 'disabled';
    expect((await query.getCapabilities()).expression_format_version).toBe(0);
    expect(() => validateExpressionDocument([node])).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.COREZA_EXPRESSION_AUTHORING;
    else process.env.COREZA_EXPRESSION_AUTHORING = previous;
  }
});
