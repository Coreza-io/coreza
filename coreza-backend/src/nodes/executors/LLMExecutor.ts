/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import { resolveReferences } from "../../utils/resolveReferences";
import CredentialManager from "../../utils/credentialManager";
import { normalizeOutput, createSuccessOutput, createErrorOutput, toNodeResult } from "../../utils/normalizeOutput";
import { isSearchModel } from "../../utils/openaiModels";

export class LLMExecutor implements INodeExecutor {
  readonly category = "LLM";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const nodeName = node.name;

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...(node.values ?? {}), ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      let result;
      switch (nodeName) {
        case "OpenAI":
          result = await this.executeOpenAI(node, combinedInput, context);
          break;
        default:
          return {
            success: false,
            error: `Unsupported LLM node type: ${nodeName}`,
          };
      }

      const normalized = normalizeOutput(result, {
        nodeId: node.id,
        nodeName: node.name,
        category: this.category,
        startTime,
      });
      return toNodeResult(normalized);
    } catch (error) {
      const normalized = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(normalized);
    }
  }

  private async executeOpenAI(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const resolvedValues = input ?? {};
      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
      if (!user_id) {
        return {
          success: false,
          error: "user_id is required for OpenAI execution",
        };
      }

      const nodeValues = node.values ?? {};
      const credential_id =
        nodeValues.credential_id ?? (resolvedValues as any)?.credential_id;
      if (!credential_id) {
        return {
          success: false,
          error: "credential_id is required",
        };
      }

      const credentialResponse = await CredentialManager.getCredentials(
        user_id,
        "openai",
        credential_id
      );
      const credentialData = credentialResponse.credentials;
      if (!credentialData) {
        return {
          success: false,
          error: "OpenAI credentials not found",
        };
      }

      const { client_json } = credentialData;

      if (!client_json?.apiKey) {
        return {
          success: false,
          error: "OpenAI apiKey is missing from credentials",
        };
      }

      const { apiKey } = client_json;

      const model = resolvedValues.model || "gpt-4o-mini";
      const payload: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        max_tokens?: number;
        web_search_options?: Record<string, unknown>;
      } = {
        model,
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
      };

      if (!isSearchModel(model)) {
        payload.temperature = resolvedValues.temperature || 0.7;
        payload.max_tokens = resolvedValues.maxTokens || 1000;
      } else {
        payload.web_search_options = {};
      }

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
