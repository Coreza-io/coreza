import compiler from '../coreza-backend/src/utils/templateCompiler';
import type { WorkflowNode } from '../coreza-backend/src/nodes/types';
const { compileNodeParams } = compiler;
const iterations = Number(process.argv[2] ?? 10000);
for (const kind of ['static', 'expressions']) for (const versioned of [false, true]) {
  const values = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`value${i}`, kind === 'static' ? i : "{{ $('source').json.count }}"]));
  if (versioned) values.__expressionFormatVersion = 1;
  const node = { id: 'target', node_type: 'main', category: 'Logic', values, data: { definition: { fields: Object.keys(values).filter(key => !key.startsWith('__')).map(key => ({ key, type: 'number' })) } } } as WorkflowNode;
  const nodes = [node, { id: 'source', node_type: 'main', category: 'Logic' }];
  const before = process.memoryUsage().heapUsed; const start = performance.now();
  const compiled = compileNodeParams(node, nodes); const compileMs = performance.now() - start;
  const outputs = { source: { json: { count: 1 } } }; const eventStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    outputs.source.json.count = i;
    const resolved = compiled.resolve ? compiled.resolve(outputs, { count: i }) : compiled.staticParams!;
    if (resolved.value0 !== (kind === 'static' ? 0 : i)) throw new Error('Benchmark output mismatch');
  }
  console.log(JSON.stringify({ kind, versioned, iterations, compileMs, resolutionMs: performance.now() - eventStart, heapDelta: process.memoryUsage().heapUsed - before }));
}
