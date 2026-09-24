import type { Node, XYPosition } from "@xyflow/react";

export type PositionMap = ReadonlyMap<string, XYPosition>;

export const capturePositions = (
  nodes: readonly Node[],
  nodeIds: Iterable<string>,
): PositionMap => {
  const requested = new Set(nodeIds);
  return new Map(nodes.flatMap((node) => requested.has(node.id)
    ? [[node.id, { ...node.position }] as const]
    : []));
};

export const translatePositions = (
  initialPositions: PositionMap,
  delta: XYPosition,
): PositionMap => new Map([...initialPositions].map(([id, position]) => [id, {
  x: position.x + delta.x,
  y: position.y + delta.y,
}]));

export const applyPositionTargets = (
  latestNodes: readonly Node[],
  targets: PositionMap,
): Node[] => latestNodes.map((node) => {
  const position = targets.get(node.id);
  return position ? { ...node, position: { ...position } } : node;
});

export const positionsEqual = (before: PositionMap, after: PositionMap): boolean =>
  before.size === after.size && [...before].every(([id, position]) => {
    const candidate = after.get(id);
    return candidate?.x === position.x && candidate.y === position.y;
  });
