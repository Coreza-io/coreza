import type { ListeningConfig } from "@/hooks/useListeningHandler";
import type { NodeConfig } from "@/nodes/schemas/nodeSchema";

type NodeDefinition = Pick<
  NodeConfig,
  "name" | "provider" | "streamingConfig"
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
    .replace(/\{\{\s*workflow_id\s*\}\}/g, workflowId)
    .replace(/\{\{\s*node_id\s*\}\}/g, nodeId)
    .replace(/\{\{\s*workflowId\s*\}\}/g, workflowId)
    .replace(/\{\{\s*nodeId\s*\}\}/g, nodeId);

export const buildWebhookListeningConfig = ({
  definition,
  fieldState,
  nodeId,
}: {
  definition: NodeDefinition;
  fieldState: Record<string, any>;
  nodeId: string;
}): ListeningConfig => {
  const listeningConfig = definition?.listeningConfig ?? {};
  const listeningFlag = listeningConfig.listeningFlag ?? "isListening";
  const timeout = listeningConfig.timeout ?? DEFAULT_WEBHOOK_TIMEOUT;
  const waitField = listeningConfig.waitField ?? "webhookPayload";
  const provider = definition?.provider;

  return {
    buildListeningOutput: (res) => ({
      status: "listening",
      message: res.message || "Waiting for webhook event...",
      startedAt: new Date().toISOString(),
      callbackUrl: res.callback_url,
      httpMethod: fieldState.httpMethod || "POST",
      nodeId,
      provider,
    }),
    isDataReceived: (nodeData) => Boolean(nodeData?.output?.[waitField]),
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: (listeningOutput) => ({
      ...(listeningOutput ?? {}),
      status: "error",
      message: `Timeout waiting for webhook event after ${
        timeout / 60000
      } minutes`,
    }),
    buildErrorOutput: (error, listeningOutput) => ({
      ...(listeningOutput ?? {}),
      status: "error",
      message: error.message,
    }),
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
    "/market/stream-test-result/{{workflow_id}}/{{node_id}}";
  const recoveryEndpoint = renderRecoveryEndpoint(
    recoveryTemplate,
    workflowId,
    nodeId,
  );
  const recoveryInterval =
    streamingConfig.recoveryPolling?.interval ?? DEFAULT_RECOVERY_INTERVAL;

  return {
    buildListeningOutput: (res) => ({
      status: "listening",
      message: `Listening for ${definition?.name || "streaming"} data...`,
      startedAt: new Date().toISOString(),
      mode: fieldState.mode || "listen",
      source: res.source,
      nodeId,
      filterSymbols: res.symbols || [],
      filterTypes: fieldState.filter_types || fieldState.stream_types || [],
      subscriptionMode: fieldState.subscriptionMode || "workflow",
    }),
    buildListeningNodeData: () => ({
      testListenWorkflowId: workflowId,
      testListenNodeId: nodeId,
    }),
    isDataReceived: () => false,
    shouldStop: (nodeData) =>
      nodeData?.isTestListening === false,
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: () => ({
      status: "timeout",
      message: "No stream data received within timeout",
    }),
    timeout,
    listeningFlag,
    receivedFlag: "streamDataReceived",
    recoveryPolling: {
      endpoint: recoveryEndpoint,
      interval: recoveryInterval,
      processResult: (result) => {
        if (result.status === "data_received") {
          return {
            done: true,
            output: {
              status: "success",
              symbol: result.data.symbol,
              type: result.data.type,
              data: result.data.data,
              receivedAt: result.data.receivedAt,
              source: result.data.source,
              [result.data.type]:
                result.data.data?.[result.data.type] || result.data.data,
            },
          };
        }
        if (result.status === "expired") {
          return {
            done: true,
            output: {
              status: "expired",
              message: "Test listener expired",
            },
            expired: true,
          };
        }
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
    definition?.streamingConfig?.subscribeListeningFlag ??
    "isStreamingWaiting";

  return {
    buildListeningOutput: (res) => ({
      status: "waiting",
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
      const output = nodeData?.output;
      return Boolean(
        output?.status === "streaming" &&
          (output.news ||
            output.data ||
            output.trade ||
            output.quote ||
            output.bar ||
            output.dailyBar),
      );
    },
    buildSuccessOutput: (nodeData) => nodeData.output,
    buildTimeoutOutput: () => ({
      status: "timeout",
      message: `Timeout waiting for ${definition?.name} data`,
    }),
    buildErrorOutput: (error) => ({
      status: "error",
      message: error.message,
    }),
    timeout,
    listeningFlag,
  };
};
