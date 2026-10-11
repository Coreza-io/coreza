import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../../../src/contexts/AuthContext';
import NodeFieldRenderer from '../../../src/components/nodes/layout/components/NodeFieldRenderer';
import { compileNodeFieldValues, previewFieldValue, type FieldPreviewScope } from '../../../coreza-backend/src/nodes/logic/fieldExpression';
import '../../../src/index.css';
import httpDefinition from '../../../src/nodes/HttpRequest.json';
import ifDefinition from '../../../src/nodes/If.json';
import switchDefinition from '../../../src/nodes/Switch.json';
import RepeaterNodeLayout from '../../../src/components/nodes/layout/RepeaterNodeLayout';
import { ReactFlowProvider } from '@xyflow/react';
import { StableNodeProvider } from '../../../src/contexts/StableNodeContext';
import { StaticExecutionStoreContext } from '../../../src/contexts/StaticExecutionStoreContext';
import ExecutionContext from '../../../src/utils/executionContext';
import { useNodeReferences } from '../../../src/hooks/useNodeReferences';
const isolatedStore = new ExecutionContext();
const fields = [
  { key: 'number', type: 'number', label: 'Number' },
  { key: 'enabled', type: 'toggle', label: 'Enabled' },
  { key: 'choice', type: 'select', label: 'Choice', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  { key: 'choices', type: 'multiselect', label: 'Choices', options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
  { key: 'secret', type: 'password', label: 'Secret' },
  { key: 'json', type: 'json', label: 'JSON' },
  { key: 'dependent', type: 'string', label: 'Dependent', displayOptions: { show: { choice: ['b'] } } },
];
function Fixture() {
  const [values, setValues] = useState<Record<string, unknown>>({ __expressionFormatVersion: 1, number: 0, enabled: false, choice: 'a', choices: ['a'], secret: '', json: { count: 2 }, dependent: 'keep me' });
  const context = { $json: { count: 3 } };
  const preview = (key: string, raw?: unknown, scope?: FieldPreviewScope) => {
    try { return { value: previewFieldValue(key, { fields: scope?.fields ?? fields, values: { ...(scope?.values ?? values), [key]: raw === undefined ? (scope?.values ?? values)[key] : raw } }, context) }; }
    catch (error) { return { error: String(error) }; }
  };
  let result: unknown;
  try { const { secret, ...resolved } = compileNodeFieldValues(values, fields).resolve(context); result = resolved; } catch (error) { result = String(error); }
  return <AuthContext.Provider value={{ user: { id: 'fixture' } as any, session: { access_token: 'fixture-token' } as any, loading: false, signOut: async () => {} }}>
    <main style={{ padding: 20, width: 600 }}>
      {fields.map(field => <div key={field.key} id={field.key}><NodeFieldRenderer field={field} definition={{ fields }} fieldState={values} value={values[field.key]}
        selectOptions={{}} loadingSelect={{}} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))}
        getPreviewResult={preview} getPreview={key => { const result = preview(key); return result.error ?? JSON.stringify(result.value); }} /></div>)}
      <StructuredFixture />
      <ReactFlowProvider><StableNodeProvider><StaticExecutionStoreContext.Provider value={{ store: isolatedStore, version: 0, notifyUpdate: () => {} }}>
        <RepeaterFixture /><RepeaterFixture kind="switch" />
      </StaticExecutionStoreContext.Provider></StableNodeProvider></ReactFlowProvider>
      <pre id="resolved">{JSON.stringify(result)}</pre><pre id="source">{JSON.stringify({ ...values, secret: '[masked]' })}</pre>
    </main>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

function StructuredFixture() {
  const fields = [
    ...httpDefinition.fields.filter(field => field.type === 'repeater'),
    { key: 'nested', type: 'repeater', label: 'Nested', subFields: [{ key: 'children', type: 'repeater', label: 'Children', subFields: [{ key: 'count', type: 'number', label: 'Count' }] }] },
    { key: 'object', type: 'object', label: 'Object', subFields: [{ key: 'enabled', type: 'boolean', label: 'Enabled' }] },
  ];
  const [values, setValues] = useState<Record<string, unknown>>({ __expressionFormatVersion: 1, body_type: 'form', headers: [{ name: 'x-example', value: 'keep' }], form_data: [{ name: 'field', value: 'keep' }], nested: [{ children: [{ count: 1 }] }], object: { enabled: false } });
  const context = { $json: { count: 3 } };
  const preview = (key: string, raw?: unknown, scope?: FieldPreviewScope) => {
    try { return { value: previewFieldValue(key, { fields: scope?.fields ?? fields, values: { ...(scope?.values ?? values), [key]: raw === undefined ? (scope?.values ?? values)[key] : raw } }, context) }; }
    catch (error) { return { error: String(error) }; }
  };
  let result;
  try { result = compileNodeFieldValues(values, fields).resolve(context); } catch (error) { result = String(error); }
  return <section id="structured">
    {fields.map(field => <div id={`structured-${field.key}`} key={field.key}><NodeFieldRenderer field={field} definition={{ fields }} fieldState={values} value={values[field.key]}
      selectOptions={{}} loadingSelect={{}} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} getPreviewResult={preview} /></div>)}
    <pre id="structured-resolved">{JSON.stringify(result)}</pre><pre id="structured-source">{JSON.stringify(values)}</pre>
  </section>;
}

function RepeaterFixture({ kind = 'if' }: { kind?: 'if' | 'switch' }) {
  const definition = kind === 'if' ? ifDefinition : switchDefinition;
  const repeaterKey = kind === 'if' ? 'conditions' : 'cases';
  const id = kind === 'if' ? 'custom-repeater' : 'switch-repeater';
  const [values, setValues] = useState<Record<string, unknown>>({ __expressionFormatVersion: 1, [repeaterKey]: '{{ $json.rows }}', logicalOps: '{{ $json.ops }}' });
  const input = { rows: [{ left: false, operator: 'is_false', right: '{{ literal data }}' }], ops: [] };
  const refs = useNodeReferences({ nodeId: 'conditional', fieldState: values, definition, previousNodes: [], selectedPrevNodeId: '', selectedPrevNode: undefined, selectedInputData: input });
  const change = (key: string, value: unknown) => { setValues(current => ({ ...current, [key]: value })); return true; };
  return <section id={id}>
    <button onClick={() => setValues({ __expressionFormatVersion: 1, [repeaterKey]: [], logicalOps: [] })}>Set explicit empty rows</button>
    <RepeaterNodeLayout {...({ definition, fieldState: values, previousNodes: [], selectedPrevNodeId: '', selectedInputData: input,
      selectOptions: {}, loadingSelect: {}, showAuth: false, setShowAuth: () => {}, handleChange: change,
      handleFieldStateBatch: (changes: Record<string, unknown>) => { setValues(current => ({ ...current, ...changes })); return true; },
      handleSubmit: async () => {}, handleDrop: () => {}, getFieldPreview: refs.getFieldPreview, getFieldPreviewResult: refs.getFieldPreviewResult,
      fetchCredentials: () => {}, fetchDependentOptions: () => {}, referenceStyle: {}, readOnly: false } as any)} />
    <pre id={`${id}-source`}>{JSON.stringify(values)}</pre>
  </section>;
}
