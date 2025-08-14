import { WorkflowEdge } from '../nodes/types';

/**
 * Branch-aware router that selects outgoing edges based on node results and sourceHandle
 */
export class NodeRouter {
  constructor(private edges: WorkflowEdge[]) {}

  // normalize outcomes of If/Switch/etc. into a list of allowed handles
  private decideHandles(result: any): string[] {
    if (typeof result === 'boolean') return [result ? 'true' : 'false'];
    if (typeof result === 'string') return [result]; // handle name directly
    if (result && typeof result === 'object') {
      if ('handle' in result && typeof result.handle === 'string') return [result.handle];
      // map-like { A: true, B: false } → pick truthy keys
      return Object.entries(result).filter(([, v]) => !!v).map(([k]) => k);
    }
    // default "no handle" path
    return ['default', '']; // allow edges with empty/null sourceHandle
  }

  // select edges based on outcome + default/explicit handle
  select(nodeId: string, result: any, opts?: { restrictToHandles?: string[] }) {
    const outgoingEdges = this.edges.filter(e => e.source === nodeId);
    
    // For conditional nodes (If, Switch), filter by handles
    const sourceNode = this.getSourceNodeType?.(nodeId);
    if (sourceNode === 'If' || sourceNode === 'Switch' || opts?.restrictToHandles) {
      const chosen = this.decideHandles(result);
      const allow = new Set(opts?.restrictToHandles ?? chosen);
      return outgoingEdges.filter(e => {
        const h = e.sourceHandle ?? '';
        return allow.has(h) || (allow.has('default') && !h);
      });
    }
    
    // For data nodes (Alpaca, etc.), return ALL outgoing edges
    return outgoingEdges;
  }

  // helper: edges labeled for loop tick vs final done
  loopBodyEdges(loopId: string) {
    return this.edges.filter(e =>
      e.source === loopId && (!e.sourceHandle || e.sourceHandle === 'loop')
    );
  }
  
  doneEdges(loopId: string) {
    return this.edges.filter(e => e.source === loopId && e.sourceHandle === 'done');
  }

  // get all outgoing edges from a node
  getOutgoingEdges(nodeId: string) {
    return this.edges.filter(e => e.source === nodeId);
  }
}