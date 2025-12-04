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
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";

import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import CredentialManager from "../../utils/credentialManager";
import { z, ZodTypeAny } from "zod";

export class AIAgentExecutor implements INodeExecutor {
  readonly category = "AIAgent";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      console.log(
        `🤖 [AIAgent] Starting AI Agent execution for node ${node.id}`
      );

      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
      if (!user_id) {
        return {
          success: false,
          error: "user_id is required for AI Agent execution",
        };
      }

      // Get edges and nodes from context
      const edges = context?.edges || [];
      const allNodes = context?.nodes || [];

      // Find connected Chat Model node
      const chatModelEdge = edges.find(
        (e: any) => e.target === node.id && e.targetHandle === "chatModel"
      );

      if (!chatModelEdge) {
        return {
          success: false,
          error: "Chat Model node must be connected to the 'Chat Model' handle",
        };
      }

      const chatModelNode = allNodes.find(
        (n: WorkflowNode) => n.id === chatModelEdge.source
      );
      if (!chatModelNode) {
        return {
          success: false,
          error: "Connected Chat Model node not found",
        };
      }

      // Get credentials from the connected Chat Model node
      const credential_id = chatModelNode.values?.credential_id;
      if (!credential_id) {
        return {
          success: false,
          error: "Chat Model node must have credentials configured",
        };
      }

      const credentialResponse = await CredentialManager.getCredentials(
        user_id,
        "openaichatmodel",
        credential_id
      );

      const client_json = credentialResponse.credentials?.client_json;
      if (!client_json) {
        return {
          success: false,
          error: "Unable to load chat model credentials",
        };
      }

      const { apiKey } = client_json;
      if (!apiKey) {
        return {
          success: false,
          error: "Chat model credential is missing apiKey",
        };
      }

      // Get model from Chat Model node
      const model = chatModelNode.values?.model || "gpt-4o-mini";

      // Resolve parameters from AI Agent node
      const nodeValues = node.values ?? {};
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...nodeValues, ...input };

      const systemPrompt =
        resolvedParams.systemPrompt ??
        nodeValues.systemPrompt ??
        "You are a helpful AI assistant. Use the available tools to help answer the user's questions.";
      const userPrompt = resolvedParams.userPrompt ?? nodeValues.userPrompt;
      const maxIterations =
        resolvedParams.maxIterations ?? nodeValues.maxIterations ?? 10;
      const temperature =
        resolvedParams.temperature ?? nodeValues.temperature ?? 0.7;
      const returnIntermediateSteps =
        resolvedParams.returnIntermediateSteps ??
        nodeValues.returnIntermediateSteps ??
        false;

      if (!userPrompt) {
        return {
          success: false,
          error: "userPrompt is required",
        };
      }

      // Initialize LLM
      const llm = new ChatOpenAI({
        modelName: model,
        temperature: temperature,
        apiKey: apiKey,
      });

      // Create tools from connected tool nodes
      const tools = await this.createToolsFromEdges(
        node,
        edges,
        allNodes,
        context
      );

      console.log(`🛠️  [AIAgent] Created ${tools.length} tools`);

      // Create agent prompt
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", systemPrompt],
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
      ]);

      // Create agent
      const agent = await createToolCallingAgent({ llm, tools, prompt });

      // Create agent executor
      const agentExecutor = await AgentExecutor.fromAgentAndTools({
        agent,
        tools,
        maxIterations,
        returnIntermediateSteps,
        verbose: true,
      });

      // Execute agent
      console.log(`🚀 [AIAgent] Executing agent with prompt: ${userPrompt}`);
      const result = await agentExecutor.invoke({
        input: userPrompt,
      });

      console.log(`✅ [AIAgent] Agent execution completed`);

      return {
        success: true,
        data: {
          output: result.output,
          intermediateSteps: returnIntermediateSteps
            ? result.intermediateSteps
            : undefined,
          input: userPrompt,
        },
      };
    } catch (error: any) {
      console.error("❌ [AIAgent] Agent execution error:", error);
      return {
        success: false,
        error: error.message || "AI Agent execution failed",
      };
    }
  }

  /**
   * Create LangChain tools from nodes connected to the "tool" handle
   */
  private async createToolsFromEdges(
    agentNode: WorkflowNode,
    edges: any[],
    allNodes: WorkflowNode[],
    context?: any
  ): Promise<DynamicStructuredTool[]> {
    const tools: DynamicStructuredTool[] = [];

    // Find all edges connected to the "tool" handle
    const toolEdges = edges.filter(
      (e: any) => e.target === agentNode.id && e.targetHandle === "tool"
    );

    if (toolEdges.length === 0) {
      console.log("⚠️  [AIAgent] No tool nodes connected");
      return tools;
    }

    console.log(`🔍 [AIAgent] Found ${toolEdges.length} tool connections`);

    for (const toolEdge of toolEdges) {
      const toolNode = allNodes.find(
        (n: WorkflowNode) => n.id === toolEdge.source
      );
      if (!toolNode) {
        console.warn(`⚠️  [AIAgent] Tool node ${toolEdge.source} not found`);
        continue;
      }

      // Create tool wrapper for this node
      const tool = this.createToolFromNode(toolNode, context);
      tools.push(tool);
      console.log(`✅ [AIAgent] Added tool: ${tool.name}`);
    }

    return tools;
  }

  /**
   * Create a LangChain DynamicStructuredTool from a workflow node
   */
  private createToolFromNode(
    node: WorkflowNode,
    context?: any
  ): DynamicStructuredTool {
    const toolName = this.getToolName(node);
    const toolDescription = this.getToolDescription(node);
    const toolSchema = this.getToolSchema(node);

    return new DynamicStructuredTool<any, any, string>({
      name: toolName,
      description: toolDescription,
      schema: toolSchema as ZodTypeAny,
      func: async (input: Record<string, any>) => {
        try {
          console.log(
            `🔧 [AIAgent] Executing tool: ${toolName} with input:`,
            input
          );

          // Get the executor for this node category
          const { getNodeExecutor } = await import("../registry");
          const executor = getNodeExecutor(node.category);

          if (!executor) {
            throw new Error(
              `No executor found for node category: ${node.category}`
            );
          }

          // Execute the node
          const result = await executor.execute(node, input, context);

          if (!result.success) {
            throw new Error(result.error || "Tool execution failed");
          }

          console.log(`✅ [AIAgent] Tool ${toolName} execution completed`);

          // Return the result as a string for the agent
          return JSON.stringify(result.data);
        } catch (error: any) {
          console.error(
            `❌ [AIAgent] Tool ${toolName} execution error:`,
            error
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
  private getToolDescription(node: WorkflowNode): string {
    // Map node types to descriptions
    const descriptionMap: Record<string, string> = {
      HttpRequest: "Make HTTP requests to external APIs",
      Market: "Get market data and stock prices",
      YahooFinance: "Get financial data from Yahoo Finance",
      FinnHub: "Get financial news and data from FinnHub",
      GoogleWebSearch:
        "Search the web using Google to find current information, news, and web pages",
      Math: "Perform mathematical calculations",
      Transform: "Transform and manipulate data",
      Gmail: "Send emails via Gmail",
      WhatsApp: "Send WhatsApp messages",
      RSI: "Calculate RSI technical indicator",
      EMA: "Calculate EMA technical indicator",
      MACD: "Calculate MACD technical indicator",
      BB: "Calculate Bollinger Bands technical indicator",
    };

    const nodeName = node.name || node.category || "node";
    return (
      descriptionMap[nodeName] ||
      `Execute ${nodeName} node to perform its configured action`
    );
  }

  /**
   * Generate a Zod schema for tool input based on node definition
   */
  private getToolSchema(node: WorkflowNode): ZodTypeAny {
    // Create schemas based on node type
    const schemaMap: Record<string, ZodTypeAny> = {
      GoogleWebSearch: z.object({
        query: z.string().describe("The search query to execute"),
        numResults: z
          .number()
          .optional()
          .describe("Number of search results to return (default: 10)"),
      }),
      HttpRequest: z.object({
        input: z.any().optional().describe("Input data for HTTP request"),
      }),
      Math: z.object({
        input: z
          .any()
          .optional()
          .describe("Input data for mathematical operation"),
      }),
    };

    const nodeName = node.name || node.category || "node";
    return (
      schemaMap[nodeName] ||
      z.object({
        input: z.any().optional().describe("Input data for the tool"),
      })
    );
  }
}
