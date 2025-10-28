import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";

import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import CredentialManager from "../../utils/credentialManager";
import { z } from "zod";

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

      const {
        credentials: { client_json },
      } = await CredentialManager.getCredentials(
        user_id,
        "openaichatmodel",
        credential_id
      );

      const { apiKey } = client_json;

      // Get model from Chat Model node
      const model = chatModelNode.values?.model || "gpt-4o-mini";

      // Resolve parameters from AI Agent node
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const systemPrompt =
        resolvedParams.systemPrompt ||
        node.values.systemPrompt ||
        "You are a helpful AI assistant. Use the available tools to help answer the user's questions.";
      const userPrompt = resolvedParams.userPrompt || node.values.userPrompt;
      const maxIterations =
        resolvedParams.maxIterations || node.values.maxIterations || 10;
      const temperature =
        resolvedParams.temperature || node.values.temperature || 0.7;
      const returnIntermediateSteps =
        resolvedParams.returnIntermediateSteps ||
        node.values.returnIntermediateSteps ||
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

    return new DynamicStructuredTool({
      name: toolName,
      description: toolDescription,
      schema: toolSchema,
      func: async (input: any) => {
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

          // Prepare enriched context with user_id and node values
          const enrichedContext = {
            ...context,
            user_id: context?.user_id || context?.userId,
            credential_id: node.values?.credential_id,
          };

          // Execute the node with enriched input and context
          const result = await executor.execute(node, input, enrichedContext);

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
    return node.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
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

    return (
      descriptionMap[node.name] ||
      `Execute ${node.name} node to perform its configured action`
    );
  }

  /**
   * Generate a Zod schema for tool input based on node definition
   */
  private getToolSchema(node: WorkflowNode): z.ZodObject<any> {
    // Create schemas based on node type
    const schemaMap: Record<string, z.ZodObject<any>> = {
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

    return (
      schemaMap[node.name] ||
      z.object({
        input: z.any().optional().describe("Input data for the tool"),
      })
    );
  }
}
