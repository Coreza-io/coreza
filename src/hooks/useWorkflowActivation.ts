import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";

const pendingRequests = new Map<string, symbol>();

/**
 * Shared activation/deactivation logic used by both Workflows.tsx and WorkflowEditor.tsx.
 *
 * - Generates a stable `executionId` on activation
 * - Calls the correct backend route: `/workflows/${workflowId}/schedule`
 * - Persists session in localStorage and dispatches the custom event
 * - Rolls back on failure
 */
export function useWorkflowActivation(scopeKey?: string) {
  const { session } = useAuth();
  const { toast } = useToast();
  const [pendingWorkflowIds, setPendingWorkflowIds] = useState<Set<string>>(new Set());
  const mounted = useRef(true);
  const scope = `${session?.user.id ?? ""}:${scopeKey ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /**
   * @returns the new `is_active` state on success, or `null` on failure.
   */
  const toggleActivation = async (
    workflowId: string,
    currentlyActive: boolean,
  ): Promise<boolean | null> => {
    if (pendingRequests.has(workflowId)) return null;
    const request = Symbol(workflowId);
    const requestScope = currentScope.current;
    pendingRequests.set(workflowId, request);
    setPendingWorkflowIds((ids) => new Set(ids).add(workflowId));
    const isCurrent = () => mounted.current && currentScope.current === requestScope;
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
      if (!isCurrent()) throw new Error("Activation session changed");

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

      const result = await res.json();
      if (typeof result.workflow?.is_active !== "boolean") {
        throw new Error("Backend returned an invalid workflow activation state");
      }
      if (!isCurrent() || localStorage.getItem(sessionStorageKey) !== (executionId ?? priorSessionId)) return null;
      const actualStatus: boolean = result.workflow.is_active;
      toast({
        title: "Success",
        description: newStatus && !actualStatus && result.message === "Backtest completed"
          ? "Backtest completed successfully"
          : `Workflow ${actualStatus ? "activated" : "deactivated"} successfully`,
      });

      return actualStatus;
    } catch (error: any) {
      const current = isCurrent() && localStorage.getItem(sessionStorageKey) === (executionId ?? priorSessionId);
      // Rollback localStorage + event on activation failure
      if (newStatus && localStorage.getItem(sessionStorageKey) === executionId) {
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

      if (!current) return null;
      toast({
        title: "Error",
        description: `Failed to ${newStatus ? "activate" : "deactivate"} workflow: ${error.message}`,
        variant: "destructive",
      });

      return null;
    } finally {
      if (pendingRequests.get(workflowId) === request) pendingRequests.delete(workflowId);
      if (mounted.current) setPendingWorkflowIds((ids) => {
        const next = new Set(ids);
        next.delete(workflowId);
        return next;
      });
    }
  };

  return {
    toggleActivation,
    isActivationPending: (workflowId: string | null) => !!workflowId && pendingWorkflowIds.has(workflowId),
  };
}
