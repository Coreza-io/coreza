import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext } from '../../../src/contexts/AuthContext';
import NodeFieldRenderer from '../../../src/components/nodes/layout/components/NodeFieldRenderer';
import { compileNodeFieldValues, compileFieldValue, evaluateFieldValue } from '../../../coreza-backend/src/nodes/logic/fieldExpression';
import '../../../src/index.css';
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
  const preview = (key: string, raw?: unknown) => {
    try { return { value: evaluateFieldValue(compileFieldValue(raw ?? values[key], fields.find(field => field.key === key)!), context) }; }
    catch (error) { return { error: String(error) }; }
  };
  let result: unknown;
  try { const { secret, ...resolved } = compileNodeFieldValues(values, fields).resolve(context); result = resolved; } catch (error) { result = String(error); }
  return <AuthContext.Provider value={{ user: { id: 'fixture' } as any, session: { access_token: 'fixture-token' } as any, loading: false, signOut: async () => {} }}>
    <main style={{ padding: 20, width: 600 }}>
      {fields.map(field => <div key={field.key} id={field.key}><NodeFieldRenderer field={field} definition={{ fields }} fieldState={values} value={values[field.key]}
        selectOptions={{}} loadingSelect={{}} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))}
        getPreviewResult={preview} getPreview={key => { const result = preview(key); return result.error ?? JSON.stringify(result.value); }} /></div>)}
      <pre id="resolved">{JSON.stringify(result)}</pre><pre id="source">{JSON.stringify({ ...values, secret: '[masked]' })}</pre>
    </main>
  </AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
