import { supabase } from "../config/supabase";
import { freezeVariableSnapshot, validateVariable, type VariableSnapshot } from "./contract";
export class VariableRepository {
  async revision(owner: string): Promise<string> {
    const { data, error } = await (supabase.rpc as any)("workflow_variables_revision", { p_owner: owner });
    if (error || typeof data !== "string" || !/^\d+$/.test(data)) throw new Error("Variable revision unavailable");
    return data;
  }
  async snapshot(owner: string): Promise<VariableSnapshot> {
    const { data, error } = await (supabase.rpc as any)("workflow_variables_snapshot", { p_owner: owner });
    if (error) throw new Error("Variable snapshot unavailable");
    return freezeVariableSnapshot(data, owner);
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
