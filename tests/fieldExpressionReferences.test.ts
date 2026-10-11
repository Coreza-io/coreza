import { remapNodeReferenceMap } from '../src/utils/remapNodeReferences';
import { compileNodeFieldValues, migrateNodeExpressionValues } from '../coreza-backend/src/nodes/logic/fieldExpression';
test('new generic references remap only code, leaving literal and escaped selectors intact', () => {
  const source = { __expressionFormatVersion: 1, active: '{{ $("old").json.count }}', literal: '\\{{ $("old").json.count }}', quoted: '{{ "$(\\"old\\").json" }}' };
  const result = remapNodeReferenceMap(source, { old: 'new' });
  expect(result.active).toContain('$("new")'); expect(result.literal).toBe(source.literal); expect(result.quoted).toBe(source.quoted);
});
test('mode-free field names and types remap, fixed migration literals stay literal', () => {
  const fields = [{ key: 'fields', type: 'repeater', subFields: [{ key: 'fieldName', type: 'string' }, { key: 'dataType', type: 'select' }, { key: 'value', type: 'text' }] }];
  const candidate = migrateNodeExpressionValues({ fields: [{ fieldName: 'literal', dataType: 'string', valueMode: 'fixed', value: '{{ $("old").json }}' }] }, fields);
  const result = remapNodeReferenceMap(candidate, { old: 'new' });
  expect(result).toEqual(candidate);
  const row = { fieldName: '{{ $("old").json.name }}', dataType: 'number', value: '{{ $("old").json.count }}', expression_format_version: 1 };
  const remapped = remapNodeReferenceMap(row, { old: 'new' });
  expect(remapped.fieldName).toContain('$("new")'); expect(remapped.value).toContain('$("new")');
  expect(compileNodeFieldValues({ fields: [remapped] }, fields).references).toEqual(['new']);
});
test('descriptor remapping preserves JSON data, inactive schema metadata and unknown fields', () => {
  const values = { __expressionFormatVersion: 1, source: '{{ $("old").json }}', data: { source: '{{ $("old").json }}' }, unknown: '{{ $("old").json }}', tab: '{{ $("old").json }}' };
  const result = remapNodeReferenceMap(values, { old: 'new' }, [{ key: 'source', type: 'text' }, { key: 'data', type: 'json' }, { key: 'tab', type: 'tabs' }]);
  expect(result.source).toContain('$("new")'); expect(result.data).toEqual(values.data); expect(result.unknown).toBe(values.unknown); expect(result.tab).toBe(values.tab);
});
