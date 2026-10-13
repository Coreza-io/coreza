import { supabase } from "../config/supabase";
import { freezeVariableSnapshot, validateVariable, type VariableChange, type VariableSnapshot } from "./contract";
export class VariableRepository {
  async revision(owner: string, workflowId?: string): Promise<string> {
    const { data, error } = await (supabase.rpc as any)("workflow_variables_revision", { p_owner: owner, ...(workflowId ? { p_workflow: workflowId } : {}) });
    if (error?.code === "40001" && /^live-variable-scope-owned\b/.test(error.message ?? "")) throw Object.assign(new Error("Live variable scope is owned"), { statusCode: 409, liveOwned: true });
    if (error || typeof data !== "string" || !/^\d+$/.test(data)) throw Object.assign(new Error("Variable revision unavailable"), { statusCode: error?.code === "42501" ? 403 : 503 });
    return data;
  }
  async snapshot(owner: string, workflowId?: string): Promise<VariableSnapshot> {
    const { data, error } = await (supabase.rpc as any)("workflow_variables_snapshot", { p_owner: owner, ...(workflowId ? { p_workflow: workflowId } : {}) });
    if (error) throw new Error("Variable snapshot unavailable");
    return freezeVariableSnapshot(data, owner, workflowId);
  }
  async commit(owner: string, workflowId: string, revision: string, token: string, changes: readonly VariableChange[]): Promise<VariableSnapshot> {
    const { data, error } = await (supabase.rpc as any)("commit_workflow_variables", {
      p_owner: owner, p_workflow: workflowId, p_expected_revision: revision, p_token: token, p_changes: changes,
    });
    if (error) throw Object.assign(new Error(error.code === "40001" ? "Variable revision/replay conflict; restart execution" : "Persistent Edit Fields commit rejected"), { statusCode: error.code === "40001" ? 409 : error.code === "42501" ? 403 : 503 });
    return freezeVariableSnapshot(data, owner, workflowId);
  }
  async mutate(owner: string, revision: string, operation: "create" | "update" | "delete", key: string, value: unknown) {
    validateVariable(key, operation === "delete" ? null : value);
    const { data, error } = await (supabase.rpc as any)("mutate_workflow_variable", { p_owner: owner, p_expected_revision: revision, p_operation: operation, p_key: key, p_value: value ?? null });
    if (error) {
      const statusCode = error.code === "40001" || error.code === "23505" ? 409 : error.code === "P0002" ? 404 : 400;
      throw Object.assign(new Error(statusCode === 409 ? "Variable revision conflict or duplicate name; reload and retry" : statusCode === 404 ? "Variable not found" : "Variable update rejected"), { statusCode });
    }
    return data as { revision: string };
  }
}
