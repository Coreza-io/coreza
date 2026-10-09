import { useCallback, useEffect, useRef, type RefObject } from "react";
import { isEditorExecutionLocked } from "@/services/editorNodeExecution";

interface Options {
  workflowSessionId: string;
  loading: boolean;
  hasInvalidMetadata: boolean;
  clusterMove: RefObject<unknown>;
  nodeDrag: RefObject<unknown>;
  selectionDrag: RefObject<boolean>;
  connectionDrag: RefObject<boolean>;
}

/** Read live drag/lock state at commit; old-session callbacks cannot mutate. */
export function useWorkflowMutationGuard({workflowSessionId, loading, hasInvalidMetadata, clusterMove, nodeDrag, selectionDrag, connectionDrag}: Options) {
  const context = useRef({workflowSessionId, loading, hasInvalidMetadata});
  const live = useRef(true);
  context.current = {workflowSessionId, loading, hasInvalidMetadata};
  useEffect(() => {
    live.current = true;
    return () => {live.current = false;};
  }, []);
  return useCallback((options: {allowConnectionDrag?: boolean; allowInvalidMetadata?: boolean} = {}) =>
    live.current && context.current.workflowSessionId === workflowSessionId && !context.current.loading &&
    (!context.current.hasInvalidMetadata || options.allowInvalidMetadata === true) &&
    !clusterMove.current && !nodeDrag.current && !selectionDrag.current &&
    (!connectionDrag.current || options.allowConnectionDrag === true) &&
    !isEditorExecutionLocked(workflowSessionId),
  [workflowSessionId, clusterMove, nodeDrag, selectionDrag, connectionDrag]);
}
