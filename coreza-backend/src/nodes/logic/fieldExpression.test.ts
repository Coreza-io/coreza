import { compileFieldValue, evaluateFieldValue, compileNodeFieldValues, migrateNodeExpressionValues, EXPRESSION_VERSION_KEY, escapeFieldLiteral } from './fieldExpression';
import { compileNodeParams, compileParamsToSlots, preCompileAllNodes } from '../../utils/templateCompiler';
import { applyFieldRows } from './editFields';
import type { WorkflowNode } from '../types';
const context = { $json: { count: 2 }, nodes: [{ id: 'history' }, { id: 'length' }], expressionOutputs: { history: { data: { value: [1, 2, 3, 4] } }, length: { data: 2 } } };
const resolve = (raw: unknown, type = 'text') => evaluateFieldValue(compileFieldValue(raw, { key: 'value', type }), context);
test.each([[0, 'number', 0], [false, 'boolean', false], ['10', 'number', 10], ['false', 'boolean', false], ['1 + 2', 'string', '1 + 2'], ['{{ 1 + 2 }}', 'string', '3'], ['[1,2]', 'array', [1, 2]], ['Hello {{ $json.count }}', 'string', 'Hello 2']])('literal and expression %p as %s', (raw, type, expected) => expect(resolve(raw, type as string)).toEqual(expected));
test('strict expression type, malformed syntax and JSON errors', () => {
  expect(() => resolve('{{ "10" }}', 'number')).toThrow('expected Number');
  expect(() => resolve('Hello {{')).toThrow('Unclosed');
  expect(() => resolve('true', 'array')).toThrow('expected Array');
  expect(() => resolve('{{ $json.absent }}')).toThrow();
});
test('single code is data and never evaluated twice', () => expect(resolve('{{ "{{ 1 + 2 }}" }}')).toBe('{{ 1 + 2 }}'));
test('nested generic computed slice with canonical context', () => expect(resolve('{{ $("history").json.data.value[-{{ $("length").json.data }}:] }}', 'array')).toEqual([3, 4]));
test('lazy missing references are not read', () => expect(resolve('{{ false && $("missing").json.value }}', 'boolean')).toBe(false));
test('literal delimiter escaping preserves backslashes and selector text', () => {
  for (const source of ['{{ x }}', 'a\\{{ x }}b', '\\\\{{ x }}', 'plain\\text', 'a {{ $("history").json }}']) expect(resolve(escapeFieldLiteral(source), 'string')).toBe(source);
});
test('all expressions enforce strict serialization', () => {
  expect(() => evaluateFieldValue(compileFieldValue('{{ $json }}', { key: 'value', type: 'text' }), { $json: [undefined] })).toThrow();
  expect(() => resolve('{{ 1 / 0 }}', 'number')).toThrow();
});
const fields = [{ key: 'fields', type: 'repeater', subFields: [{ key: 'fieldName', type: 'string' }, { key: 'dataType', type: 'select' }, { key: 'value', type: 'text' }] }];
test('migration is idempotent, preserves fixed templates and unknown metadata', () => {
  const original = { fields: [{ fieldName: 'x', dataType: 'string', valueMode: 'fixed', value: '{{ 1 + 2 }}', custom: { id: 4 } }], extra: false };
  const candidate = migrateNodeExpressionValues(original, fields);
  expect(original.fields[0].valueMode).toBe('fixed');
  expect(candidate[EXPRESSION_VERSION_KEY]).toBe(1);
  expect(migrateNodeExpressionValues(candidate, fields)).toBe(candidate);
  const output = compileNodeFieldValues(JSON.parse(JSON.stringify(candidate)), fields).resolve(context);
  expect(applyFieldRows(output.fields as any, { input: {}, legacyResultSeed: {} })).toEqual({ x: '{{ 1 + 2 }}' });
  expect((output.fields as any)[0].custom).toEqual({ id: 4 });
});
test('dynamic controlling fields resolve before visibility, inactive missing references remain unread', () => {
  const values = { mode: '{{ "off" }}', active: '{{ $("missing").json }}' };
  const result = compileNodeFieldValues(values, [{ key: 'mode', type: 'select', options: [{ value: 'off' }, { value: 'on' }] }, { key: 'active', type: 'text', displayOptions: { show: { mode: ['on'] } } }]).resolve(context);
  expect(result).toEqual({ mode: 'off' });
});
test('compiled map and slots use fresh current input', () => {
  const node = { id: 'n', node_type: 'main', category: 'Logic', values: { [EXPRESSION_VERSION_KEY]: 1, value: '{{ $json.count }}' }, data: { definition: { fields: [{ key: 'value', type: 'number' }] } } } as WorkflowNode;
  const compiled = compileNodeParams(node, [node]);
  const slots = compileParamsToSlots(compiled, new Map([['n', 0]]))!;
  expect(compiled.resolve!({}, { count: 2 })).toEqual({ value: 2 });
  expect(slots([], { count: 3 })).toEqual({ value: 3 });
  expect(slots([], { count: 4 })).toEqual({ value: 4 });
  expect(() => preCompileAllNodes([{ ...node, values: { [EXPRESSION_VERSION_KEY]: 1, value: '{{' } }])).toThrow('Unclosed');
});
test('legacy non-reference templates receive conversion diagnostics and literal backslashes survive', () => {
  const descriptor = [{ key: 'value', type: 'text' }];
  expect(() => migrateNodeExpressionValues({ value: '{{ 1 + 2 }}' }, descriptor)).toThrow('explicit conversion');
  const candidate = migrateNodeExpressionValues({ value: 'C:\\\\folder' }, descriptor);
  expect(compileNodeFieldValues(candidate, descriptor).resolve(context).value).toBe('C:\\\\folder');
});
test('native structured expression results never have their strings parsed again', () => {
  const raw = { fields: '{{ $json.rows }}' };
  const result = compileNodeFieldValues(raw, fields).resolve({ $json: { rows: [{ value: '{{ 1 + 2 }}' }] } });
  expect(result.fields).toEqual([{ value: '{{ 1 + 2 }}' }]);
});
test('native objects cannot become String through implicit String(object)', () => expect(() => resolve({ x: 1 }, 'string')).toThrow('expected String'));
test('empty Number and Boolean remain invalid, explicit null and empty String are distinct', () => {
  expect(() => resolve('', 'number')).toThrow('empty');
  expect(() => resolve('', 'boolean')).toThrow('expected Boolean');
  expect(resolve(null, 'string')).toBeNull(); expect(resolve('', 'string')).toBe('');
});
test('ambiguous identities are diagnosed only when their lazy branch is evaluated', () => {
  const nodes: WorkflowNode[] = [{ id: 'n', node_type: 'main', category: 'Logic', values: { __expressionFormatVersion: 1, value: '{{ false && $("Alias").json }}' }, data: { definition: { fields: [{ key: 'value', type: 'boolean' }] } } }, { id: 'a', displayName: 'Alias', node_type: 'main', category: 'Logic' }, { id: 'b', displayName: 'Alias', node_type: 'main', category: 'Logic' }];
  expect(compileNodeParams(nodes[0], nodes).resolve!({}, {})).toEqual({ value: false });
});
test('literal JSON arrays preserve delimiter characters in string data', () => expect(resolve('["{{ not_expression }}"]', 'array')).toEqual(['{{ not_expression }}']));
test('structured repeater JSON source uses declared child descriptors', () => {
  const value = JSON.stringify([{ fieldName: 'count', dataType: 'number', expression_format_version: 1, value: '{{ $json.count }}' }]);
  expect(compileNodeFieldValues({ fields: value }, fields).resolve(context).fields).toEqual([{ fieldName: 'count', dataType: 'number', valueMode: 'fixed', value: 2 }]);
});
test('logical operator array items evaluate and validate as runtime selectors', () => {
  const descriptors = [{ key: 'logicalOps', type: 'hidden', resultType: 'array' as const, items: { key: 'operator', type: 'select', options: [{ value: 'AND' }, { value: 'OR' }] } }];
  expect(compileNodeFieldValues({ logicalOps: ['{{ "OR" }}'] }, descriptors).resolve(context)).toEqual({ logicalOps: ['OR'] });
  expect(() => compileNodeFieldValues({ logicalOps: ['{{ "X" }}'] }, descriptors).resolve(context)).toThrow('allowed option');
});
test('migration does not interpret unknown row metadata or JSON data as typed rows', () => {
  const metadata = { fieldName: 'metadata', dataType: 'number', valueMode: 'fixed', value: 'invalid number' };
  const original = { fields: [{ fieldName: 'x', dataType: 'number', valueMode: 'fixed', value: '1', metadata }], json: metadata };
  const candidate = migrateNodeExpressionValues(original, [...fields, { key: 'json', type: 'json' }]);
  expect((candidate.fields as any)[0].metadata).toEqual(metadata);
  expect(candidate.json).toEqual(metadata);
});
test('runtime bounds, nullability and multiselect option maps validate after evaluation', () => {
  expect(() => evaluateFieldValue(compileFieldValue('{{ 0 }}', { key: 'period', type: 'number', min: 1 }), context)).toThrow('bounds');
  expect(() => evaluateFieldValue(compileFieldValue(null, { key: 'period', type: 'number', nullable: false }), context)).toThrow('Null');
  const descriptor = { key: 'choices', type: 'multiselect', options: [{ id: 'base', valueMap: { values: { next: 'mapped' } } }] };
  expect(compileNodeFieldValues({ choices: '{{ ["mapped"] }}' }, [descriptor]).resolve(context).choices).toEqual(['mapped']);
  expect(() => compileNodeFieldValues({ choices: '{{ ["unknown"] }}' }, [descriptor]).resolve(context)).toThrow('allowed option');
});
test('dynamic row types select precompiled literal/template variants with fresh input', () => {
  const source = { fields: [{ fieldName: 'result', dataType: '{{ $json.type }}', expression_format_version: 1, value: '["{{ 1 + 2 }}"]' }] };
  const compiled = compileNodeFieldValues(source, fields);
  expect((compiled.resolve({ $json: { type: 'array' } }).fields as any)[0].value).toEqual(['{{ 1 + 2 }}']);
  expect((compiled.resolve({ $json: { type: 'string' } }).fields as any)[0].value).toBe('["3"]');
});
