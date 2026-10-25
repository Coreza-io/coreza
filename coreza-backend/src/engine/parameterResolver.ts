import { WorkflowNode } from "../nodes/types";
import { resolveReferences } from "../utils/resolveReferences";
import {
  CompiledNodeParams,
  preCompileAllNodes,
} from "../utils/templateCompiler";
import { isTypedEditFieldRow } from "../nodes/logic/typedEditFieldRow";
import { isFixedField, parameterEntries } from "../utils/fieldValueModes";
//import { loadNodeDefinition } from "../nodes/nodeDefinitions";

export class ParameterResolver {
  private compiledParams: Map<string, CompiledNodeParams>;
  private nodeHasTemplatesCache = new Map<string, boolean>();

  constructor(private readonly nodes: WorkflowNode[]) {
    // Materialize compatibility values before template compilation or execution snapshots.
    for (const node of nodes) {
      if (node.name === "Portfolio" || node.type === "Portfolio") {
        node.values = { cumulativeFilledQty: false, fillPriceMode: "execution", ...node.values };
      }
    }
    // Backend safety net: merge any missing definition defaults into node
    // values so live execution never fails due to fields added after the
    // workflow was last saved.
    // for (const node of nodes) {
    //   const def = loadNodeDefinition(node.name || "");
    //   if (def?.fields && node.values) {
    //     for (const field of def.fields) {
    //       if (
    //         field.key &&
    //         field.default !== undefined &&
    //         node.values[field.key] === undefined
    //       ) {
    //         node.values[field.key] = field.default;
    //       }
    //     }
    //   }
    // }

    this.compiledParams = preCompileAllNodes(nodes);
  }

  resolve(
    node: WorkflowNode,
    input: any,
    getAllResults: () => Record<string, any>,
    variables?: Readonly<Record<string, unknown>>,
  ): Record<string, any> {
    const compiled = this.compiledParams.get(node.id);
    if (compiled) {
      if (!compiled.hasTemplates) return compiled.staticParams ?? {};
      if (compiled.resolve) {
        const allNodeData = getAllResults();
        const parameters = compiled.resolve(allNodeData, input);
        // Plans can be reused by overlapping runs with different pinned revisions.
        const resolved = variables ? { ...parameters } : parameters;
        if (compiled.fallbackKeys?.length) {
          for (const key of compiled.fallbackKeys) {
            resolved[key] = this.resolveDeep(
              resolved[key],
              input,
              allNodeData,
              this.isEditFieldsNode(node) && key === "fields",
              variables,
            );
          }
        }
        return resolved;
      }
    }

    const nodeParams = node.values || {};
    if (!this.nodeHasTemplates(node.id, nodeParams)) {
      const out: Record<string, any> = {};
      for (const [key, value] of parameterEntries(nodeParams)) {
        // if (key !== "credential_id") out[key] = value;
        out[key] = isFixedField(nodeParams, key) ? value : this.resolveDeep(
          value, input, {}, this.isEditFieldsNode(node) && key === "fields", variables,
        );
      }
      return out;
    }

    const allNodeData = getAllResults();
    const resolvedParams: Record<string, any> = {};
    for (const [key, value] of parameterEntries(nodeParams)) {
      //if (key === "credential_id") continue;
      resolvedParams[key] = isFixedField(nodeParams, key) ? value : this.resolveDeep(
        value,
        input,
        allNodeData,
        this.isEditFieldsNode(node) && key === "fields",
        variables,
      );
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
    editFieldsRows = false,
    variables?: Readonly<Record<string, unknown>>,
  ): any {
    if (typeof val === "string" && val.includes("{{")) {
      return resolveReferences(val, input, allNodeData, this.nodes, variables);
    }
    if (Array.isArray(val)) {
      return val.map((item) => {
        if (editFieldsRows && isTypedEditFieldRow(item)) return item;
        return this.resolveDeep(item, input, allNodeData, false, variables);
      });
    }
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        parameterEntries(val).map(([k, v]) => [
          k,
          isFixedField(val, k) ? v : this.resolveDeep(v, input, allNodeData, false, variables),
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

  private isEditFieldsNode(node: WorkflowNode): boolean {
    return (
      node.name === "Edit Fields" ||
      node.type === "Edit Fields" ||
      node.data?.definition?.name === "Edit Fields"
    );
  }
}
