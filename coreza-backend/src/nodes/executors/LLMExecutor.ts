import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import { resolveReferences } from "../../utils/resolveReferences";
import CredentialManager from "../../utils/credentialManager";

export class LLMExecutor implements INodeExecutor {
  readonly category = "LLM";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.name;

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
        case "OpenAI":
          result = await this.executeOpenAI(node, combinedInput, context);
          break;
        default:
          return {
            success: false,
            error: `Unsupported LLM node type: ${nodeType}`,
          };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `LLM execution failed: ${
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
      const resolvedValues = input;
      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
      if (!user_id) {
        return {
          success: false,
          error: "user_id is required for OpenAI execution",
        };
      }

      const credential_id = node.values.credential_id;
      if (!credential_id) {
        return {
          success: false,
          error: "credential_id is required",
        };
      }

      const {
        credentials: { client_json, token_json },
      } = await CredentialManager.getCredentials(
        user_id,
        "openai",
        credential_id
      );

      const { apiKey } = client_json;

      const payload = {
        model: resolvedValues.model || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: resolvedValues.prompt || "You are a helpful assistant.",
          },
          {
            role: "user",
            content: resolvedValues.userMessage || "Hello!",
          },
        ],
        temperature: resolvedValues.temperature || 0.7,
        max_tokens: resolvedValues.maxTokens || 1000,
      };

      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        payload,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      const completion = response.data.choices[0].message.content;

      if (response.data) {
        return {
          success: true,
          data: completion,
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
