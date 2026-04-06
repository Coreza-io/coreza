import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared activation/deactivation logic used by both Workflows.tsx and WorkflowEditor.tsx.
 *
 * - Generates a stable `executionId` on activation
 * - Calls the correct backend route: `/workflows/${workflowId}/schedule`
 * - Persists session in localStorage and dispatches the custom event
 * - Rolls back on failure
 */
export function useWorkflowActivation() {
  const { session } = useAuth();
  const { toast } = useToast();

  /**
   * @returns the new `is_active` state on success, or `null` on failure.
   */
  const toggleActivation = async (
    workflowId: string,
    currentlyActive: boolean,
  ): Promise<boolean | null> => {
    const newStatus = !currentlyActive;
    const sessionStorageKey = `live_session_${workflowId}`;
    const priorSessionId = localStorage.getItem(sessionStorageKey);

    // Generate session ID only when activating
    const executionId = newStatus ? crypto.randomUUID() : undefined;

    // Optimistically set the new session so the live page resets immediately
    if (newStatus && executionId) {
      localStorage.setItem(sessionStorageKey, executionId);
      window.dispatchEvent(
        new CustomEvent("coreza-live-session-updated", {
          detail: { workflowId, sessionId: executionId },
        }),
      );
    }

    try {
      // Health check
      const healthCheck = await apiClient.get(
        "/health",
        session?.access_token,
      );
      if (!healthCheck.ok) {
        throw new Error("Backend server is not responding");
      }

      // Single backend call — this handles DB update + runner lifecycle
      const res = await apiClient.put(
        `/workflows/${workflowId}/schedule`,
        { is_active: newStatus, executionId },
        session?.access_token,
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText);
      }

      toast({
        title: "Success",
        description: `Workflow ${newStatus ? "activated" : "deactivated"} successfully`,
      });

      return newStatus;
    } catch (error: any) {
      // Rollback localStorage + event on activation failure
      if (newStatus) {
        if (priorSessionId) {
          localStorage.setItem(sessionStorageKey, priorSessionId);
        } else {
          localStorage.removeItem(sessionStorageKey);
        }
        window.dispatchEvent(
          new CustomEvent("coreza-live-session-updated", {
            detail: { workflowId, sessionId: priorSessionId },
          }),
        );
      }

      toast({
        title: "Error",
        description: `Failed to ${newStatus ? "activate" : "deactivate"} workflow: ${error.message}`,
        variant: "destructive",
      });

      return null;
    }
  };

  return { toggleActivation };
}
