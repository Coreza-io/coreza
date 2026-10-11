import { isExpressionContract } from '../nodes/logic/fieldExpression';
import { compileNodeParams } from '../utils/templateCompiler';
import type { WorkflowNode } from '../nodes/types';

/** Validate syntax before persistence, and refuse lossy dialect downgrades. */
export function validateExpressionDocument(candidate: WorkflowNode[], previous: WorkflowNode[] = []): void {
  const byId = new Map(candidate.map(node => [node.id, node]));
  for (const old of previous) {
    const next = byId.get(old.id);
    if (next && isExpressionContract(old.values) && !isExpressionContract(next.values))
      throw Object.assign(new Error('expression-writer-upgrade-required'), { statusCode: 409, isOperational: true });
  }
  for (const node of candidate) {
    try { if (isExpressionContract(node.values)) compileNodeParams(node, candidate); }
    catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { statusCode: 400, isOperational: true }); }

  }
}
