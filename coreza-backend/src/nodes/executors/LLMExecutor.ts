import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import { resolveReferences } from "../../utils/resolveReferences";

export class LLMExecutor implements INodeExecutor {
  readonly category = "LLM";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.type;

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
      const values = node.data?.values || node.values || {};
      const resolvedValues = resolveReferences(values, input);
      
      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
      if (!user_id) {
        return {
          success: false,
          error: "user_id is required for OpenAI execution",
        };
      }

      const credential_id = resolvedValues.credential_id;
      if (!credential_id) {
        return {
          success: false,
          error: "credential_id is required",
        };
      }

      const payload = {
        user_id,
        credential_id,
        model: resolvedValues.model || "gpt-4o-mini",
        prompt: resolvedValues.prompt || "You are a helpful assistant.",
        userMessage: resolvedValues.userMessage,
        temperature: resolvedValues.temperature || 0.7,
        maxTokens: resolvedValues.maxTokens || 1000,
      };

      // Call the backend OpenAI route
      const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
      const response = await axios.post(
        `${backendUrl}/openai/chat`,
        payload,
        {
          headers: {
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
