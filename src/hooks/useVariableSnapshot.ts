import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { freezeVariableSnapshot, type VariableSnapshot } from "../../coreza-backend/src/variables/contract";

export const variablesUIEnabled = import.meta.env.VITE_WORKFLOW_VARIABLES_ENABLED === "true";
export async function loadVariableSnapshot(owner: string, token?: string): Promise<VariableSnapshot> {
  if (!variablesUIEnabled) throw new Error("Workflow variables are disabled");
  const response = await apiClient.get("/variables/snapshot", token);
  if (!response.ok) throw new Error("Variable snapshot unavailable");
  return freezeVariableSnapshot(await response.json(), owner);
}
export function useVariableSnapshot(required: boolean) {
  const { user, session } = useAuth();
  return useQuery({
    queryKey: ["workflow-variables", user?.id],
    queryFn: () => loadVariableSnapshot(user!.id, session?.access_token),
    enabled: required && variablesUIEnabled && !!user,
    staleTime: 0,
    gcTime: 60000,
    retry: false,
  });
}
