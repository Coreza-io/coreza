import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import { getBrokerConfig } from "../../config/brokers";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";

export class BrokerExecutor implements INodeExecutor {
  readonly category = "Broker";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const brokerNode = node as WorkflowNode & { subCategory?: string };
      const broker = (brokerNode.subCategory ?? node.name ?? node.node_type)?.toLowerCase();
      const credential_id = node.values?.credential_id;

      if (!credential_id) {
        return {
          success: false,
          error: `${broker || "Broker"} credential_id is required`,
        };
      }

      // Get broker config (in-memory lookup, no HTTP)
      const config = getBrokerConfig(broker);
      if (!config) {
        return {
          success: false,
          error: `Unsupported broker: ${broker}`,
        };
      }

      const op = config.operations[operation];
      if (!op) {
        return {
          success: false,
          error: `Unsupported operation: ${operation} for ${broker}`,
        };
      }

      // Resolve and merge node parameters with input data
      console.log(
        `🔧 [BROKER] Starting parameter resolution for node ${node.id}`
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `🔧 [BROKER] Parameter resolution completed for node ${node.id}`
      );

      // Fetch credentials directly (no HTTP)
      const { credentials } = await CredentialManager.getCredentials(
        context?.userId,
        broker,
        credential_id
      );

      if (!credentials) {
        return {
          success: false,
          error: `Credentials not found for ${broker}`,
        };
      }

      const creds = credentials.client_json;

      // Handle OAuth token refresh if needed
      let workingCreds = creds;
      if (broker === "schwab") {
        workingCreds = await refreshOAuthTokenIfNeeded(
          'schwab',
          creds,
          context?.userId,
          credential_id
        );
      }

      // Build request to EXTERNAL broker API
      const baseUrl =
        typeof config.baseUrl === "function"
          ? config.baseUrl(workingCreds, resolvedParams)
          : config.baseUrl;

      const path =
        typeof op.path === "function"
          ? op.path(resolvedParams, workingCreds)
          : op.path;

      const url = `${baseUrl}${path}`;
      const headers = await config.makeAuthHeaders(workingCreds);
      const params = op.makeParams?.(resolvedParams, workingCreds) ?? {};
      const body = op.makeBody
        ? await op.makeBody(resolvedParams, workingCreds)
        : undefined;

      console.log(
        `📤 [BROKER] Executing ${broker}.${operation} → ${url}`
      );

      // Execute request to external broker (Alpaca/Dhan/Schwab/Binance)
      const response = await axios({
        method: op.method,
        url,
        headers: { ...headers, "Content-Type": "application/json" },
        params,
        data: body,
        timeout: 30000,
      });

      console.log(
        `✅ [BROKER] ${broker}.${operation} completed successfully`
      );

      // Transform result
      const data = op.transformResult
        ? op.transformResult(response.data, resolvedParams)
        : response.data;

      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error(`❌ [BROKER] Execution failed:`, error);
      return {
        success: false,
        error: `Broker execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}