jest.mock("../src/services/gmail/GmailPollerManager", () => ({
  gmailPollerManager: {
    stop: jest.fn().mockResolvedValue(true),
  },
}));

const { getProviderConfig } = require("../src/config/webhookProviders");
const {
  gmailPollerManager,
} = require("../src/services/gmail/GmailPollerManager");

describe("gmail webhook provider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops the Gmail poller when deleting the webhook", async () => {
    const providerConfig = getProviderConfig("gmail");

    await expect(
      providerConfig.externalApi.deleteWebhook("fallback-credential", {
        workflowId: "workflow-1",
        nodeId: "node-1",
        credentialId: "credential-1",
      }),
    ).resolves.toBe(true);

    expect(gmailPollerManager.stop).toHaveBeenCalledWith(
      "workflow-1",
      "node-1",
      "credential-1",
    );
  });
});
