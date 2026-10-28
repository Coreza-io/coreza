import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";
import { toast } from "@/hooks/use-toast";
import { useEffect, useRef, useState } from "react";

interface PendingRequest { token: symbol; activating: boolean }
const pendingRequests = new Map<string, PendingRequest>();

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
  const [pendingWorkflows, setPendingWorkflows] = useState<Map<string, PendingRequest>>(new Map());
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
    const newStatus = !currentlyActive;
    const pending = pendingRequests.get(workflowId);
    // Stop can supersede the synchronous activation request; duplicate actions cannot.
    if (pending && (newStatus || !pending.activating)) return null;
    const request = Symbol(workflowId);
    const entry = { token: request, activating: newStatus };
    const requestScope = currentScope.current;
    pendingRequests.set(workflowId, entry);
    setPendingWorkflows((requests) => new Map(requests).set(workflowId, entry));
    const isCurrent = () => mounted.current && currentScope.current === requestScope
      && pendingRequests.get(workflowId)?.token === request;
    const sessionStorageKey = `live_session_${workflowId}`;
    let priorSessionId: string | null = null;
    let executionId: string | undefined;

    try {
      priorSessionId = localStorage.getItem(sessionStorageKey);
      // Generate session ID only when activating
      executionId = newStatus ? crypto.randomUUID() : undefined;

      // Optimistically set the new session so the live page resets immediately
      if (newStatus && executionId) {
        localStorage.setItem(sessionStorageKey, executionId);
        window.dispatchEvent(
          new CustomEvent("coreza-live-session-updated", {
            detail: { workflowId, sessionId: executionId },
          }),
        );
      }

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
      if (actualStatus && result.workflow.active_execution_id) {
        localStorage.setItem(sessionStorageKey, result.workflow.active_execution_id);
        window.dispatchEvent(new CustomEvent("coreza-live-session-updated", {
          detail: { workflowId, sessionId: result.workflow.active_execution_id },
        }));
      }
      toast({
        title: "Success",
        description: newStatus && !actualStatus && result.message === "Backtest completed"
          ? "Backtest completed successfully"
          : `Workflow ${actualStatus ? "activated" : "deactivated"} successfully`,
      });

      return actualStatus;
    } catch (error: any) {
      let current = isCurrent();
      try {
        current = current && localStorage.getItem(sessionStorageKey) === (executionId ?? priorSessionId);
        // Rollback localStorage + event on activation failure
        if (current && newStatus && executionId) {
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
      } catch {
        // Storage failures must still release the pending request below.
      }

      if (!current) return null;
      toast({
        title: "Error",
        description: `Failed to ${newStatus ? "activate" : "deactivate"} workflow: ${error.message}`,
        variant: "destructive",
      });

      return null;
    } finally {
      if (pendingRequests.get(workflowId)?.token === request) pendingRequests.delete(workflowId);
      if (mounted.current) setPendingWorkflows((requests) => {
        if (requests.get(workflowId)?.token !== request) return requests;
        const next = new Map(requests);
        next.delete(workflowId);
        return next;
      });
    }
  };

  return {
    toggleActivation,
    isActivationPending: (workflowId: string | null, currentlyActive = false) => {
      const pending = workflowId ? pendingWorkflows.get(workflowId) : undefined;
      return !!pending && (!currentlyActive || !pending.activating);
    },
  };
}
