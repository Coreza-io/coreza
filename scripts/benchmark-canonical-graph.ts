import type { Edge, Node } from "@xyflow/react";
import { createCanonicalGraphStore } from "../src/contexts/canonicalGraphStore";

const fixtureSizes = [20, 100, 300] as const;
const frames = 1_000;
const runs = 3;

const percentile = (values: readonly number[], ratio: number): number => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0;
};

const createFixture = (size: number): { nodes: Node[]; edges: Edge[] } => ({
  nodes: Array.from({ length: size }, (_, index) => ({
    id: `node-${index}`,
    position: { x: (index % 10) * 320, y: Math.floor(index / 10) * 220 },
    data: { displayName: `Node ${index}`, values: { period: index + 1 } },
  })),
  edges: Array.from({ length: Math.max(0, size - 1) }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
    sourceHandle: "output",
    targetHandle: "input",
  })),
});

for (const size of fixtureSizes) {
  const fixture = createFixture(size);
  const elapsedRuns: number[] = [];
  const frameIntervals: number[] = [];
  let fullNotifications = 0;
  let semanticNotifications = 0;
  for (let run = 0; run < runs; run += 1) {
    const store = createCanonicalGraphStore();
    store.subscribe(() => { fullNotifications += 1; });
    store.subscribeSemantic(() => { semanticNotifications += 1; });
    store.publish(fixture.nodes, fixture.edges, `fixture-${size}-${run}`);
    let nodes = fixture.nodes;
    const startedAt = performance.now();
    for (let frame = 0; frame < frames; frame += 1) {
      const frameStartedAt = performance.now();
      nodes = nodes.map((node, index) => index === 0
        ? { ...node, position: { x: frame, y: frame / 2 }, dragging: true }
        : node);
      store.publish(nodes, fixture.edges, `fixture-${size}-${run}`);
      frameIntervals.push(performance.now() - frameStartedAt);
    }
    elapsedRuns.push(performance.now() - startedAt);
  }
  console.log(JSON.stringify({
    nodes: size,
    edges: fixture.edges.length,
    frames,
    runs,
    medianRunMs: Number(percentile(elapsedRuns, 0.5).toFixed(2)),
    p95PublicationMs: Number(percentile(frameIntervals, 0.95).toFixed(3)),
    fullNotifications,
    semanticNotifications,
  }));
}
