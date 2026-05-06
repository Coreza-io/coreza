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
import { DynamicStructuredTool } from "@langchain/core/tools";

import { createAgent } from "langchain";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import CredentialManager from "../../utils/credentialManager";
import { z, ZodTypeAny } from "zod";
import {
  processToolOutput,
  resolveDataRef,
} from "../../nodes/logic/toolOutputProcessor";
import { DataContext, DataContextManager } from "../../engine";
import {
  TOOL_DEFINITIONS,
  ToolDefinition,
} from "../../nodes/logic/toolDefinitions";
import { loadNodeDefinition } from "../nodeDefinitions";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  NormalizeContext,
} from "../../utils/normalizeOutput";
import { getLLM, LLMConfig } from "../../config/llmProviders";

export class AIAgentExecutor implements INodeExecutor {
  readonly category = "AIAgent";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const normalizeCtx: NormalizeContext = {
      nodeId: node.id,
      nodeName: node.name,
      category: node.category,
      startTime,
    };

    // Create DataContext for this agent execution
    const executionId =
      context?.executionId ||
      context?.runId ||
      `agent-${node.id}-${Date.now()}`;
    const workflowId = context?.workflowId || "unknown";
    const userId = context?.userId || "unknown";

    const dataContextManager = DataContextManager.getInstance();
    const dataContext = dataContextManager.getContext({
      executionId,
      workflowId,
      userId,
    });

    try {
      console.log(
        `🤖 [AIAgent] Starting AI Agent execution for node ${node.id} (execution: ${executionId})`,
      );

      // Get user_id from context
      const user_id = context?.userId;
      if (!user_id) {
        const errOutput = createErrorOutput(
          "user_id is required for AI Agent execution",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      // Get edges and nodes from context
      const edges = context?.edges || [];
      const allNodes = context?.nodes || [];

      // Find connected Chat Model node
      const chatModelEdge = edges.find(
        (e: any) => e.target === node.id && e.targetHandle === "chatModel",
      );

      if (!chatModelEdge) {
        const errOutput = createErrorOutput(
          "Chat Model node must be connected to the 'Chat Model' handle",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      const chatModelNode = allNodes.find(
        (n: WorkflowNode) => n.id === chatModelEdge.source,
      );
      if (!chatModelNode) {
        const errOutput = createErrorOutput(
          "Connected Chat Model node not found",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      // Get credentials from the connected Chat Model node
      const credential_id = chatModelNode.values?.credential_id;
      if (!credential_id) {
        const errOutput = createErrorOutput(
          "Chat Model node must have credentials configured",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      // Get provider from Chat Model node (supports OpenAI, Gemini, etc.)
      const providerId = chatModelNode.provider;
      const serviceType = chatModelNode.name?.toLowerCase?.();

      console.log(
        `🔌 [AIAgent] Using LLM provider: ${providerId} (service: ${serviceType})`,
      );

      const credentialResponse = await CredentialManager.getCredentials(
        user_id,
        serviceType,
        credential_id,
      );

      const client_json = credentialResponse.credentials?.client_json;
      if (!client_json) {
        const errOutput = createErrorOutput(
          "Unable to load chat model credentials",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      const apiKey = client_json.apiKey;
      if (!apiKey) {
        const errOutput = createErrorOutput(
          "Chat model credential is missing apiKey",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      // Get model from Chat Model node
      const model = chatModelNode.values?.model;

      // Resolve parameters from AI Agent node
      const nodeValues = node.values ?? {};
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...nodeValues, ...input };

      const systemPrompt =
        resolvedParams.systemPrompt ??
        "You are a helpful AI assistant. Use the available tools to help answer the user's questions.";
      const userPrompt = resolvedParams.userPrompt;
      const maxIterations = resolvedParams.maxIterations ?? 10;
      //const temperature = resolvedParams.temperature ?? 1;

      if (!userPrompt) {
        const errOutput = createErrorOutput(
          "userPrompt is required",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      const isSearchModel = chatModelNode.values?.isSearchModel === true;
      const isReasoningModel = chatModelNode.values?.supportsReasoning === true;

      const llmConfig: LLMConfig = {
        apiKey,
        model,
        maxTokens: chatModelNode.values?.maxTokens
          ? Number(chatModelNode.values.maxTokens)
          : undefined,
        isSearchModel,
        isReasoningModel,
      };

      if (!isSearchModel && !isReasoningModel) {
        llmConfig.temperature = Number(resolvedParams.temperature);
      }

      if (isReasoningModel) {
        llmConfig.reasoningEffort =
          chatModelNode.values?.reasoningEffort ?? "medium";
      }

      const llm = getLLM(providerId, llmConfig);

      console.log(
        `🤖 [AIAgent] Created ${providerId} LLM with model: ${model}`,
      );

      // Create tools from connected tool nodes - pass dataContext
      const tools = await this.createToolsFromEdges(node, edges, allNodes, {
        ...context,
        dataContext,
      });

      console.log(`🛠️  [AIAgent] Created ${tools.length} tools`);

      // Create agent using the new LangChain agent API
      const agent = createAgent({
        model: llm,
        tools,
      });

      // Execute agent
      console.log(`🚀 [AIAgent] Executing agent with prompt: ${userPrompt}`);
      const result = await agent.invoke(
        {
          messages: [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
          ],
        },
        {
          recursionLimit: Number(maxIterations),
        },
      );

      console.log(`✅ [AIAgent] Agent execution completed`);

      // Log memory stats
      const stats = dataContext.getStats();
      console.log(
        `📊 [AIAgent] Memory used: ${stats.entryCount} entries, ${(
          stats.totalSizeBytes /
          1024 /
          1024
        ).toFixed(2)}MB`,
      );

      const agentOutput = this.getAgentOutput(result);
      const successOutput = createSuccessOutput(agentOutput, normalizeCtx);
      return toNodeResult(successOutput);
    } catch (error: any) {
      console.error("❌ [AIAgent] Agent execution error:", error);
      const errOutput = createErrorOutput(
        error.message || "AI Agent execution failed",
        normalizeCtx,
      );
      return toNodeResult(errOutput);
    } finally {
      // Cleanup DataContext after agent execution
      dataContextManager.destroyContext(executionId);
    }
  }

  /**
   * Create LangChain tools from nodes connected to the "tool" handle
   */
  private async createToolsFromEdges(
    agentNode: WorkflowNode,
    edges: any[],
    allNodes: WorkflowNode[],
    context?: any,
  ): Promise<DynamicStructuredTool[]> {
    const tools: DynamicStructuredTool[] = [];

    // Find all edges connected to the "tool" handle
    const toolEdges = edges.filter(
      (e: any) => e.target === agentNode.id && e.targetHandle === "tool",
    );

    if (toolEdges.length === 0) {
      console.log("⚠️  [AIAgent] No tool nodes connected");
      return tools;
    }

    console.log(`🔍 [AIAgent] Found ${toolEdges.length} tool connections`);

    for (const toolEdge of toolEdges) {
      const toolNode = allNodes.find(
        (n: WorkflowNode) => n.id === toolEdge.source,
      );
      if (!toolNode) {
        console.warn(`⚠️  [AIAgent] Tool node ${toolEdge.source} not found`);
        continue;
      }

      // Create tool wrapper for this node
      const isToggled = (toolNode as any).__isTool === true;
      const tool = this.createToolFromNode(toolNode, context);
      tools.push(tool);
      console.log(
        `✅ [AIAgent] Added tool: ${tool.name}${isToggled ? " (toggled)" : ""}`,
      );
    }

    return tools;
  }

  /**
   * Create a LangChain DynamicStructuredTool from a workflow node
   */
  private createToolFromNode(
    node: WorkflowNode,
    context?: any,
  ): DynamicStructuredTool {
    const toolName = this.getToolName(node);
    const definition = this.getToolDefinition(node);
    const toolDescription = this.getToolDescription(node, definition);
    const toolSchema = this.getToolSchema(node, definition);
    const dataContext = context?.dataContext as DataContext | undefined;
    const executorCategory = this.getExecutorCategory(node, definition);

    return new DynamicStructuredTool<any, any, string>({
      name: toolName,
      description: toolDescription,
      schema: toolSchema as ZodTypeAny,
      func: async (input: Record<string, any>) => {
        try {
          console.log(
            `🔧 [AIAgent] Executing tool: ${toolName} with input:`,
            input,
          );

          // Resolve any dataRef inputs to actual data
          const resolvedInput = resolveDataRef(input, dataContext);

          // Unwrap nested input if agent sends { input: { ... } } wrapper
          const unwrappedInput =
            resolvedInput.input &&
            typeof resolvedInput.input === "object" &&
            !Array.isArray(resolvedInput.input)
              ? { ...resolvedInput, ...resolvedInput.input }
              : resolvedInput;

          // Normalize node name for underlying executor (strip "Tool" suffix)
          const normalizedNode = {
            ...node,
            name: node.name,
            values: { ...node.values, ...unwrappedInput },
          };

          // Get the executor for this node category
          const { getNodeExecutor } = await import("../registry");
          const executor = getNodeExecutor(executorCategory);

          if (!executor) {
            throw new Error(
              `No executor found for node category: ${node.category}`,
            );
          }

          // Execute the normalized node with unwrapped input
          const result = await executor.execute(
            normalizedNode,
            unwrappedInput,
            context,
          );

          if (!result.success) {
            throw new Error(result.error || "Tool execution failed");
          }

          console.log(`✅ [AIAgent] Tool ${toolName} execution completed`);

          // Process output through dataRef pattern (use normalized name for matching)
          const processedOutput = processToolOutput(
            normalizedNode.name || node.category || "",
            node.category || "",
            result.data,
            dataContext,
            unwrappedInput, // Pass tool input so symbol can be extracted
          );

          // Return processed output (dataRef + summary, not raw data)
          return JSON.stringify(processedOutput);
        } catch (error: any) {
          console.error(
            `❌ [AIAgent] Tool ${toolName} execution error:`,
            error,
          );
          return `Error executing tool ${toolName}: ${error.message}`;
        }
      },
    });
  }

  /**
   * Generate a tool name from a node
   */
  private getToolName(node: WorkflowNode): string {
    // Use node type as tool name, sanitized
    const rawName = node.name || node.category || `node_${node.id}`;
    return rawName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }

  /**
   * Generate a tool description from a node
   */
  private getToolDescription(
    node: WorkflowNode,
    definition?: ToolDefinition,
  ): string {
    if (node.description) {
      return node.description;
    }

    if ((node as any).def) {
      return (node as any).def;
    }

    if (definition) {
      return definition.description;
    }

    const nodeName = node.name || node.category || "node";
    return `Execute ${nodeName} node to perform its configured action`;
  }

  private fieldToZodType(field: any): ZodTypeAny {
    let zodType: ZodTypeAny;

    switch (field.type) {
      case "number":
        zodType = z.coerce.number();
        if (field.default !== undefined) {
          zodType = zodType.default(Number(field.default));
        }
        break;
      case "select": {
        const options = field.options?.map((o: any) => o.id || o.value) || [];
        if (options.length > 0) {
          zodType = z.enum(options as [string, ...string[]]);
        } else {
          zodType = z.string();
        }
        if (field.default !== undefined) {
          zodType = zodType.default(field.default);
        }
        break;
      }
      case "checkbox":
        zodType = z.boolean();
        if (field.default !== undefined) {
          zodType = zodType.default(Boolean(field.default));
        }
        break;
      case "text":
      case "password":
      case "textarea":
      default:
        zodType = z.string();
        if (field.default !== undefined) {
          zodType = zodType.default(String(field.default));
        }
    }

    const desc = field.description || field.placeholder || field.label;
    if (desc) {
      zodType = zodType.describe(desc);
    }

    if (!field.required) {
      zodType = zodType.optional();
    }

    return zodType;
  }

  private generateSchemaFromNode(node: WorkflowNode): ZodTypeAny {
    const fields = (node as any).fields || [];
    const schemaObject: Record<string, ZodTypeAny> = {};

    for (const field of fields) {
      if (field.type === "hidden") continue;
      if (field.key === "credential_id") continue;

      schemaObject[field.key] = this.fieldToZodType(field);
    }

    const nodeCategory = (node as any).subCategory || node.category || "";
    const nodeName = node.name || "";

    if (
      nodeCategory.includes("Indicator") ||
      nodeCategory.includes("Market") ||
      nodeCategory.includes("Broker") ||
      nodeName.includes("Alpaca") ||
      nodeName.includes("Finance") ||
      nodeName.includes("Polygon") ||
      nodeName.includes("FinnHub")
    ) {
      schemaObject["dataRef"] = z
        .string()
        .optional()
        .describe("Reference to previously fetched market data");
    }

    return z.object(schemaObject);
  }

  /**
   * Generate a Zod schema for tool input based on node definition
   */
  private getToolSchema(
    node: WorkflowNode,
    definition?: ToolDefinition,
  ): ZodTypeAny {
    let nodeFields = (node as any).fields;

    // If workflow node doesn't have fields, try to load from JSON definition
    if (!nodeFields || !Array.isArray(nodeFields) || nodeFields.length === 0) {
      const nodeName = node.name || "";
      let nodeDefinition = loadNodeDefinition(nodeName);

      if (nodeDefinition?.fields && nodeDefinition.fields.length > 0) {
        nodeFields = nodeDefinition.fields;
        console.log(
          `📋 [AIAgent] Loaded ${nodeFields.length} fields from ${nodeDefinition.name} JSON definition`,
        );
      }
    }

    if (nodeFields && Array.isArray(nodeFields) && nodeFields.length > 0) {
      // Create a temp node with fields for schema generation
      const nodeWithFields = { ...node, fields: nodeFields };
      const schema = this.generateSchemaFromNode(
        nodeWithFields as WorkflowNode,
      );

      // Log schema keys for debugging
      if (schema && typeof schema === "object" && "shape" in schema) {
        console.log(
          `📋 [AIAgent] Tool ${node.name} schema keys:`,
          Object.keys((schema as any).shape || {}),
        );
      }

      return schema;
    }

    if (definition && definition.schema) {
      return definition.schema;
    }

    return z.object({
      input: z.any().optional().describe("Input data for the tool"),
    });
  }

  private getToolDefinition(node: WorkflowNode): ToolDefinition | undefined {
    const nodeName = node.name || node.category || "node";
    return TOOL_DEFINITIONS[nodeName];
  }

  private getExecutorCategory(
    node: WorkflowNode,
    definition?: ToolDefinition,
  ): string {
    const nodeName = node.name || node.category || "node";

    const executorCategoryMap: Record<string, string> = {
      //Broker
      Alpaca: "Broker",
      Binance: "Broker",
      Schwab: "Broker",
      Dhan: "Broker",
      // Market data providers
      YahooFinance: "DataSource",
      FinnHub: "DataSource",
      Polygon: "DataSource",
      Market: "Market",

      // Indicators
      RSI: "Indicators",
      EMA: "Indicators",
      SMA: "Indicators",
      MACD: "Indicators",
      BB: "Indicators",
      ADX: "Indicators",
      Stoch: "Indicators",
      Ichimoku: "Indicators",
      OBV: "Indicators",
      VWAP: "Indicators",
      VolumeOscillator: "Indicators",
      SupportResistance: "Indicators",

      // Screeners
      AlpacaScreener: "Screener",
      BinanceScreener: "Screener",
      YahooFinanceScreener: "Screener",
      SchwabScreener: "Screener",

      // Utilities / tools
      GoogleWebSearch: "Tool",
      HttpRequest: "Utility",
      Math: "ControlFlow",
      Transform: "ControlFlow",
      Date: "ControlFlow",
      Field: "ControlFlow",
    };

    return (
      executorCategoryMap[nodeName] ||
      definition?.category ||
      node.category ||
      "Utility"
    );
  }

  private getAgentOutput(result: any): string {
    const messages = result?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      if (typeof result?.output === "string") {
        return result.output;
      }

      if (typeof result?.content === "string") {
        return result.content;
      }

      return result ? JSON.stringify(result) : "";
    }

    const getMessageType = (message: any): string => {
      if (!message) return "";

      if (typeof message._getType === "function") {
        return message._getType();
      }

      return (
        message.role ??
        message.type ??
        message.lc_kwargs?.type ??
        message.kwargs?.type ??
        message.constructor?.name ??
        ""
      )
        .toString()
        .toLowerCase();
    };

    const getMessageContent = (message: any): any => {
      return (
        message?.content ??
        message?.lc_kwargs?.content ??
        message?.kwargs?.content ??
        message?.additional_kwargs?.content
      );
    };

    const isAIMessage = (message: any): boolean => {
      const type = getMessageType(message);

      return (
        type === "ai" ||
        type === "assistant" ||
        type === "aimessage" ||
        type.includes("aimessage") ||
        type.includes("ai_message")
      );
    };

    const formatContent = (content: any): string => {
      if (typeof content === "string") {
        return content;
      }

      if (Array.isArray(content)) {
        return content
          .map((block) => {
            if (typeof block === "string") {
              return block;
            }

            if (block?.type === "text" && typeof block.text === "string") {
              return block.text;
            }

            if (typeof block?.text === "string") {
              return block.text;
            }

            if (typeof block?.content === "string") {
              return block.content;
            }

            return JSON.stringify(block);
          })
          .join("");
      }

      if (content && typeof content === "object") {
        return JSON.stringify(content);
      }

      return "";
    };

    // Prefer the last AI/assistant message with non-empty content
    const lastAIMessageWithContent = [...messages].reverse().find((message) => {
      if (!isAIMessage(message)) return false;

      const content = getMessageContent(message);
      const formatted = formatContent(content).trim();

      return formatted.length > 0;
    });

    if (lastAIMessageWithContent) {
      return formatContent(getMessageContent(lastAIMessageWithContent));
    }

    // Fallback: last message with any non-empty content, but skip ToolMessage if possible
    const lastMessageWithContent = [...messages].reverse().find((message) => {
      const type = getMessageType(message);
      if (type === "tool" || type === "toolmessage") return false;

      const content = getMessageContent(message);
      return formatContent(content).trim().length > 0;
    });

    if (lastMessageWithContent) {
      return formatContent(getMessageContent(lastMessageWithContent));
    }

    // Last fallback: stringify final message safely
    const lastMessage = messages[messages.length - 1];
    const fallbackContent = getMessageContent(lastMessage);

    if (fallbackContent) {
      return formatContent(fallbackContent);
    }

    return JSON.stringify(result);
  }
}
