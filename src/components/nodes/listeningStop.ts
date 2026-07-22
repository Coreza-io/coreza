export interface NodeStopAction {
  url?: string;
  method?: string;
}

export interface ListenerNodeDefinition {
  executionMode?: string;
  provider?: string;
  listeningConfig?: {
    listeningFlag?: string;
  };
  streamingConfig?: {
    listeningFlag?: string;
  };
  stopAction?: NodeStopAction;
}

export const STREAM_LISTENING_FLAG = "isTestListening";
export const WEBHOOK_LISTENING_FLAG = "isListening";
export const DEFAULT_STREAM_STOP_URL = "/stream/unregister";
export const DEFAULT_STOP_METHOD = "POST";

export const LISTENER_CLEAR_STATE = {
  isTestListening: false,
  isListening: false,
  isStreamPaused: false,
  isStreamStepping: false,
} as const;

export const resolveListeningFlagKey = (
  definition?: ListenerNodeDefinition,
): string =>
  definition?.listeningConfig?.listeningFlag ??
  definition?.streamingConfig?.listeningFlag ??
  (definition?.executionMode === "streaming"
    ? STREAM_LISTENING_FLAG
    : WEBHOOK_LISTENING_FLAG);

export const resolveStopAction = (
  definition?: ListenerNodeDefinition,
): Required<NodeStopAction> => ({
  url: definition?.stopAction?.url ?? DEFAULT_STREAM_STOP_URL,
  method: definition?.stopAction?.method ?? DEFAULT_STOP_METHOD,
});

export const buildStopListeningPayload = ({
  definition,
  workflowId,
  nodeId,
  credentialId,
}: {
  definition?: ListenerNodeDefinition;
  workflowId: string;
  nodeId: string;
  credentialId?: string;
}): Record<string, string | undefined> => ({
  provider: definition?.provider,
  credential_id: credentialId,
  credentialId,
  workflow_id: workflowId,
  workflowId,
  node_id: nodeId,
  nodeId,
});
