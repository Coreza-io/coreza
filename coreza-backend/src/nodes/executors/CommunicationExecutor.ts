import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { CommunicationService } from "../../services/communications";
import axios from "axios";
import { resolveReferences } from "../../utils/resolveReferences";
import CredentialManager from "../../utils/credentialManager";

export class CommunicationExecutor implements INodeExecutor {
  readonly category = "Communication";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      const operation = node.values?.operation || "send";

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      let result;
      switch (nodeType) {
        case "Gmail":
          result = await CommunicationService.execute(
            "gmail",
            operation,
            combinedInput
          );
          break;
        case "WhatsApp":
          result = await CommunicationService.execute(
            "whatsapp",
            operation,
            combinedInput
          );
          break;
        case "OpenAI":
          return this.executeOpenAI(node, combinedInput, context);
        default:
          return {
            success: false,
            error: `Unsupported communication node type: ${nodeType}`,
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodeType} ${operation} operation failed`,
        };
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Communication execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async executeOpenAI(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const values = node.data?.values || node.values || {};
      const resolvedValues = resolveReferences(values, input);
      const credential_id = resolvedValues.credential_id;

      const payload = {
        model: resolvedValues.model || "gpt-4o-mini",
        prompt: resolvedValues.prompt || "You are a helpful assistant.",
        userMessage: resolvedValues.userMessage,
        temperature: resolvedValues.temperature || 0.7,
        maxTokens: resolvedValues.maxTokens || 1000,
      };
      const {
        credentials: { client_json, token_json },
      } = await CredentialManager.getCredentials(
        user_id,
        "openai",
        credential_id
      );

      const { apiKey } = client_json;

      if (!apiKey) {
        return res.status(400).json({ error: "API key is required" });
      }

      const messages = [
        {
          role: "system",
          content: payload.prompt || "You are a helpful assistant.",
        },
        { role: "user", content: payload.userMessage },
      ];

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          payload,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.success) {
        return {
          success: true,
          data: response.data.data,
        };
      } else {
        return {
          success: false,
          error: response.data.error || "OpenAI execution failed",
        };
      }
    } catch (error: any) {
      console.error("OpenAI execution error:", error);
      return {
        success: false,
        error:
          error.response?.data?.error ||
          error.message ||
          "OpenAI execution failed",
      };
    }
  }
}
