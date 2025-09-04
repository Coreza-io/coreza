import { WorkflowEdge } from "../nodes/types";

/**
 * Branch-aware router that selects outgoing edges based on node results and sourceHandle
 */
export class NodeRouter {
  constructor(private edges: WorkflowEdge[]) {}

  // normalize outcomes of If/Switch/etc. into a list of allowed handles
  private decideHandles(result: any): string[] {
    if (typeof result === "boolean") return [result ? "true" : "false"];
    if (typeof result === "string") return [result]; // handle name directly
    if (
      result &&
      typeof result === "object" &&
      ("true" in result || "false" in result)
    ) {
      // map-like { A: true, B: false } → pick truthy keys
      return Object.entries(result)
        .filter(([, v]) => !!v)
        .map(([k]) => k);
    }
    // default "no handle" path
    return ["default", ""]; // allow edges with empty/null sourceHandle
  }

  // select edges based on outcome + default/explicit handle
  select(nodeId: string, result: any) {
    const outgoingEdges = this.edges.filter((e) => e.source === nodeId);
    if (nodeId === "If" || nodeId === "Switch") {
      const chosen = this.decideHandles(result);
      const allow = new Set(chosen);
      return outgoingEdges.filter((e) => {
        const h = e.sourceHandle ?? "";
        return allow.has(h);
      });
    }

    // For data nodes (Alpaca, etc.), return ALL outgoing edges
    return outgoingEdges;
  }

  // helper: edges labeled for loop tick vs final done
  loopBodyEdges(loopId: string) {
    return this.edges.filter(
      (e) =>
        e.source === loopId && (!e.sourceHandle || e.sourceHandle === "loop")
    );
  }

  doneEdges(loopId: string) {
    return this.edges.filter(
      (e) => e.source === loopId && e.sourceHandle === "done"
    );
  }

  // get all outgoing edges from a node
  getOutgoingEdges(nodeId: string) {
    return this.edges.filter((e) => e.source === nodeId);
  }
}
