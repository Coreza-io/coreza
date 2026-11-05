import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { freezeVariableSnapshot, type VariableSnapshot } from "../../coreza-backend/src/variables/contract";
import { activeEditorVariableScope, bindEditorVariableOwner, variableQueryKey, type EditorVariableScope } from "@/services/editorVariableScopes";
import { subscribeEditorExecution } from "@/services/editorNodeExecution";

export async function loadVariableSnapshot(owner: string, token?: string, workflowId?: string, scope?: EditorVariableScope): Promise<VariableSnapshot> {
  if (!workflowId) throw new Error("Save the workflow before using variables");
  if (!scope) throw new Error("Editor variable scope required; refresh the editor");
  bindEditorVariableOwner(scope, owner, workflowId, token);
  const response = await apiClient.get(`/variables/snapshot?workflowId=${encodeURIComponent(workflowId)}&scope=${encodeURIComponent(JSON.stringify(scope))}`, token);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? body.message ?? "Variable snapshot unavailable");
  bindEditorVariableOwner(scope, owner, workflowId, token); // Reject a late response after teardown.
  return freezeVariableSnapshot(body, owner, workflowId);
}
export function useVariableSnapshot(required: boolean, workflowId?: string, workflowSessionId = "") {
  const { user, session } = useAuth();
  const client = useQueryClient();
  const scope = useSyncExternalStore(
    listener => subscribeEditorExecution(workflowSessionId, listener),
    () => activeEditorVariableScope(workflowSessionId),
  );
  const key = variableQueryKey(user?.id, workflowId, scope);
  return useQuery({
    queryKey: key,
    queryFn: () => {
      bindEditorVariableOwner(scope, user!.id, workflowId!, session?.access_token, () => {
        void client.cancelQueries({ queryKey: key, exact: true });
        client.removeQueries({ queryKey: key, exact: true });
      }, client);
      return loadVariableSnapshot(user!.id, session?.access_token, workflowId, scope);
    },
    enabled: Boolean(required && user && workflowId && workflowSessionId),
    staleTime: 0,
    gcTime: 60000,
    retry: false,
  });
}
