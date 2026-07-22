import {
  LISTENER_CLEAR_STATE,
  buildStopListeningPayload,
  resolveListeningFlagKey,
  resolveStopAction,
  type ListenerNodeDefinition,
} from "../src/components/nodes/listeningStop";

const webhookDefinitions: ListenerNodeDefinition[] = [
  {
    executionMode: "webhook_listening",
    provider: "generic",
    listeningConfig: { listeningFlag: "isListening" },
    stopAction: { url: "/webhooks/unregister", method: "POST" },
  },
  {
    executionMode: "webhook_listening",
    provider: "telegram",
    listeningConfig: { listeningFlag: "isListening" },
    stopAction: { url: "/webhooks/unregister", method: "POST" },
  },
  {
    executionMode: "webhook_listening",
    provider: "gmail",
    listeningConfig: { listeningFlag: "isListening" },
    stopAction: { url: "/webhooks/unregister", method: "POST" },
  },
];

describe("listening stop metadata", () => {
  it.each(webhookDefinitions)(
    "resolves webhook-listening triggers to the webhook unregister action for %s",
    (definition) => {
      expect(resolveListeningFlagKey(definition)).toBe("isListening");
      expect(resolveStopAction(definition)).toEqual({
        url: "/webhooks/unregister",
        method: "POST",
      });
    },
  );

  it("preserves stream listener stop behavior", () => {
    const definition: ListenerNodeDefinition = {
      executionMode: "streaming",
      streamingConfig: { listeningFlag: "isTestListening" },
      stopAction: { url: "/stream/unregister", method: "POST" },
    };

    expect(resolveListeningFlagKey(definition)).toBe("isTestListening");
    expect(resolveStopAction(definition)).toEqual({
      url: "/stream/unregister",
      method: "POST",
    });
  });

  it("builds a webhook-compatible defensive unregister payload", () => {
    expect(
      buildStopListeningPayload({
        definition: webhookDefinitions[2],
        workflowId: "workflow-1",
        nodeId: "node-1",
        credentialId: "credential-1",
      }),
    ).toEqual({
      provider: "gmail",
      credential_id: "credential-1",
      credentialId: "credential-1",
      workflow_id: "workflow-1",
      workflowId: "workflow-1",
      node_id: "node-1",
      nodeId: "node-1",
    });
  });

  it("clears both webhook and stream listener state flags", () => {
    expect(LISTENER_CLEAR_STATE).toEqual({
      isTestListening: false,
      isListening: false,
      isStreamPaused: false,
      isStreamStepping: false,
    });
  });
});
