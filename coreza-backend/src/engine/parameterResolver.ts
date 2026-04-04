import { WorkflowNode } from "../nodes/types";
import { resolveReferences } from "../utils/resolveReferences";
import {
  CompiledNodeParams,
  preCompileAllNodes,
} from "../utils/templateCompiler";

export class ParameterResolver {
  private compiledParams: Map<string, CompiledNodeParams>;
  private nodeHasTemplatesCache = new Map<string, boolean>();

  constructor(private readonly nodes: WorkflowNode[]) {
    this.compiledParams = preCompileAllNodes(nodes);
  }

  resolve(
    node: WorkflowNode,
    input: any,
    getAllResults: () => Record<string, any>,
  ): Record<string, any> {
    const compiled = this.compiledParams.get(node.id);
    if (compiled) {
      if (!compiled.hasTemplates) return compiled.staticParams ?? {};
      if (compiled.resolve) {
        const allNodeData = getAllResults();
        const resolved = compiled.resolve(allNodeData, input);
        if (compiled.fallbackKeys?.length) {
          for (const key of compiled.fallbackKeys) {
            resolved[key] = this.resolveDeep(resolved[key], input, allNodeData);
          }
        }
        return resolved;
      }
    }

    const nodeParams = node.values || {};
    if (!this.nodeHasTemplates(node.id, nodeParams)) {
      const out: Record<string, any> = {};
      for (const [key, value] of Object.entries(nodeParams)) {
        if (key !== "credential_id") out[key] = value;
        //out[key] = value;
      }
      return out;
    }

    const allNodeData = getAllResults();
    const resolvedParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(nodeParams)) {
      if (key === "credential_id") continue;
      resolvedParams[key] = this.resolveDeep(value, input, allNodeData);
    }
    return resolvedParams;
  }

  getCompiledParams(): Map<string, CompiledNodeParams> {
    return this.compiledParams;
  }

  private resolveDeep(
    val: any,
    input: any,
    allNodeData: Record<string, any>,
  ): any {
    if (typeof val === "string" && val.includes("{{")) {
      return resolveReferences(val, input, allNodeData, this.nodes);
    }
    if (Array.isArray(val)) {
      return val.map((item) => this.resolveDeep(item, input, allNodeData));
    }
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [
          k,
          this.resolveDeep(v, input, allNodeData),
        ]),
      );
    }
    return val;
  }

  private nodeHasTemplates(nodeId: string, params: any): boolean {
    if (this.nodeHasTemplatesCache.has(nodeId)) {
      return this.nodeHasTemplatesCache.get(nodeId)!;
    }
    const hasTemplates = this.containsTemplates(params);
    this.nodeHasTemplatesCache.set(nodeId, hasTemplates);
    return hasTemplates;
  }

  private containsTemplates(value: any): boolean {
    if (typeof value === "string") return value.includes("{{");
    if (Array.isArray(value))
      return value.some((v) => this.containsTemplates(v));
    if (value && typeof value === "object") {
      return Object.values(value).some((v) => this.containsTemplates(v));
    }
    return false;
  }
}
