import { resultState, resultFailure } from "@/utils/nodeResult";
import type { ListeningConfig } from "@/hooks/useListeningHandler";
import type { NodeConfig } from "@/nodes/schemas/nodeSchema";

type NodeDefinition = Pick<
  NodeConfig,
  "name" | "provider" | "streamingConfig" | "subCategory"
> & {
  listeningConfig?: {
    waitField?: string;
    timeout?: number;
    listeningFlag?: string;
  };
};

const DEFAULT_WEBHOOK_TIMEOUT = 300000;
const DEFAULT_STREAMING_TIMEOUT = 300000;
const DEFAULT_SUBSCRIBE_TIMEOUT = 30000;
const DEFAULT_RECOVERY_INTERVAL = 10000;

const renderRecoveryEndpoint = (
  template: string,
  workflowId: string,
  nodeId: string,
): string =>
  template
    .replace(/\{\{\s*workflowId\s*\}\}/g, workflowId)
    .replace(/\{\{\s*node_id\s*\}\}/g, nodeId)
    .replace(/\{\{\s*workflowId\s*\}\}/g, workflowId)
    .replace(/\{\{\s*nodeId\s*\}\}/g, nodeId);

export const buildWebhookListeningConfig = ({
  definition,
  fieldState,
  nodeId,
  workflowId,
}: {
  definition: NodeDefinition;
  fieldState: Record<string, any>;
  nodeId: string;
  workflowId?: string;
}): ListeningConfig => {
  const listeningConfig = definition?.listeningConfig ?? {};
  const listeningFlag = listeningConfig.listeningFlag ?? "isListening";
  const timeout = listeningConfig.timeout ?? DEFAULT_WEBHOOK_TIMEOUT;
  const waitField = listeningConfig.waitField ?? "webhookPayload";
  const provider = definition?.provider;

  return {
    buildListeningOutput: (res) => resultState("listening", {
      message: res.message || "Waiting for webhook event...",
      startedAt: new Date().toISOString(),
      callbackUrl: res.callback_url,
      httpMethod: fieldState.httpMethod || "POST",
      nodeId,
      provider,
    }),
    buildListeningNodeData: () => ({ testListenWorkflowId: workflowId, testListenNodeId: nodeId }),
    isDataReceived: (nodeData) => nodeData?.output?.status === "success" && nodeData.output.data != null && Object.prototype.hasOwnProperty.call(nodeData.output.data, waitField),
    shouldStop: (nodeData) => nodeData?.[listeningFlag] === false,
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: (listeningOutput) => resultFailure(`Timeout waiting for webhook event after ${timeout / 60000} minutes`, {
      data: listeningOutput?.data, details: { code: "LISTENER_TIMEOUT" },
    }),
    buildErrorOutput: (error, listeningOutput) => resultFailure(error.message, { data: listeningOutput?.data }),
    timeout,
    listeningFlag,
  };
};

export const buildStreamingTriggerListeningConfig = ({
  definition,
  fieldState,
  nodeId,
  workflowId,
}: {
  definition: NodeDefinition;
  fieldState: Record<string, any>;
  nodeId: string;
  workflowId: string;
}): ListeningConfig => {
  const streamingConfig = definition?.streamingConfig ?? {};
  const listeningFlag = streamingConfig.listeningFlag ?? "isTestListening";
  const timeout = streamingConfig.timeout ?? DEFAULT_STREAMING_TIMEOUT;
  const recoveryTemplate =
    streamingConfig.recoveryPolling?.endpoint ??
    "/market/stream-test-result/{{workflowId}}/{{node_id}}";
  const recoveryEndpoint = renderRecoveryEndpoint(
    recoveryTemplate,
    workflowId,
    nodeId,
  );
  const recoveryInterval =
    streamingConfig.recoveryPolling?.interval ?? DEFAULT_RECOVERY_INTERVAL;

  return {
    buildListeningOutput: (res) => resultState("listening", {
      message: `Listening for ${definition?.name || "streaming"} data...`,
      startedAt: new Date().toISOString(),
      mode: res.mode,
      source: res.source,
      symbols: res.symbols || [],
      streamType: res.streamType || [],
      scope: res.scope,
    }),
    buildListeningNodeData: () => ({
      testListenWorkflowId: workflowId,
      testListenNodeId: nodeId,
      testListenSource: fieldState.source || definition?.subCategory,
    }),
    isDataReceived: () => false,
    shouldStop: (nodeData) => nodeData?.isTestListening === false,
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: () => resultFailure("No stream data received within timeout", { details: { code: "LISTENER_TIMEOUT" } }),
    timeout: Number.MAX_SAFE_INTEGER,
    listeningFlag,
    receivedFlag: "streamDataReceived",
    recoveryPolling: {
      endpoint: recoveryEndpoint,
      interval: recoveryInterval,
      processResult: (result) => {
        if (result.status === "expired") {
          return {
            done: true,
            output: resultFailure("Test listener expired", { details: { code: "LISTENER_EXPIRED" } }),
            expired: true,
          };
        }
        // Data received via recovery — don't resolve, WebSocket handles continuous updates
        return { done: false };
      },
    },
  };
};

export const buildStreamingSubscribeListeningConfig = ({
  definition,
  fieldState,
  nodeId,
  payload,
}: {
  definition: NodeDefinition;
  fieldState: Record<string, any>;
  nodeId: string | undefined;
  payload: { parsedSymbols?: string[] };
}): ListeningConfig => {
  const timeout =
    definition?.streamingConfig?.timeout ?? DEFAULT_SUBSCRIBE_TIMEOUT;
  const listeningFlag =
    definition?.streamingConfig?.subscribeListeningFlag ?? "isStreamingWaiting";

  return {
    buildListeningOutput: (res) => resultState("waiting", {
      message: `Listening for ${definition?.name} data...`,
      subscribedAt: new Date().toISOString(),
      symbols: payload.parsedSymbols,
      streamTypes: fieldState.stream_types || [],
      nodeId: nodeId ?? undefined,
      news: {},
      subscriptions: res?.subscriptions,
      lastActionMessage: res?.message,
    }),
    isDataReceived: (nodeData) => {
      const result = nodeData?.output;
      const status = result?.status;
      const output = result?.data;
      return Boolean(
        status === "streaming" &&
        (output?.news ||
          output?.data ||
          output?.trade ||
          output?.quote ||
          output?.bar ||
          output?.dailyBar),
      );
    },
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: () => resultFailure(`Timeout waiting for ${definition?.name} data`, { details: { code: "LISTENER_TIMEOUT" } }),
    buildErrorOutput: (error) => resultFailure(error.message),
    timeout,
    listeningFlag,
  };
};
