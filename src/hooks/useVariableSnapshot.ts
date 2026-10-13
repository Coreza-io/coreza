import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { freezeVariableSnapshot, type VariableSnapshot } from "../../coreza-backend/src/variables/contract";

export async function loadVariableSnapshot(owner: string, token?: string, workflowId?: string): Promise<VariableSnapshot> {
  if (!workflowId) throw new Error("Save the workflow before using persistent variables");
  const response = await apiClient.get(`/variables/snapshot?workflowId=${encodeURIComponent(workflowId)}`, token);
  if (!response.ok) throw new Error("Variable snapshot unavailable");
  return freezeVariableSnapshot(await response.json(), owner, workflowId);
}
export function useVariableSnapshot(required: boolean, workflowId?: string) {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["workflow-variables", user?.id, workflowId],
    queryFn: () => loadVariableSnapshot(user!.id, session?.access_token, workflowId),
    enabled: Boolean(required && user && workflowId),
    staleTime: 0,
    gcTime: 60000,
    retry: false,
  });
}
