import { performance } from "perf_hooks";
import { compileEditTemplate, evaluateEditTemplate } from "../src/nodes/logic/editTemplate";
import { freezeVariableSnapshot } from "../src/variables/contract";
const entries = Array.from({ length: 128 }, (_, index) => ({ key: `VALUE_${index}`, value: index, value_type: "number", updated_at: new Date().toISOString() }));
const snapshot = freezeVariableSnapshot({ owner: "benchmark", revision: "1", loadedAt: Date.now(), schemaVersion: 1, entries }, "benchmark");
const expression = compileEditTemplate("{{ $vars.VALUE_127 * 2 }}");
const times: number[] = [];
const before = process.memoryUsage().heapUsed;
for (let i = 0; i < 1000; i++) evaluateEditTemplate(expression, { $json: {}, $vars: snapshot.values });
for (let i = 0; i < 10000; i++) {
  const start = performance.now(); evaluateEditTemplate(expression, { $json: {}, $vars: snapshot.values }); times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({ reads: times.length, p50_ms: times[5000], p95_ms: times[9500], snapshot_bytes: Buffer.byteLength(JSON.stringify(snapshot)), heap_delta_bytes: process.memoryUsage().heapUsed - before }));
