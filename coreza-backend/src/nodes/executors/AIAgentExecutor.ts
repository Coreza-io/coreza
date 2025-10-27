import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { ChatOpenAI } from "@langchain/openai";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentExecutor, createOpenAIFunctionsAgent } from "langchain/agents";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import CredentialManager from "../../utils/credentialManager";
import { z } from "zod";

export class AIAgentExecutor implements INodeExecutor {
  readonly category = "LLM";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      console.log(`🤖 [AIAgent] Starting AI Agent execution for node ${node.id}`);

      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
      if (!user_id) {
        return {
          success: false,
          error: "user_id is required for AI Agent execution",
        };
      }

      const credential_id = node.values.credential_id;
      if (!credential_id) {
        return {
          success: false,
          error: "credential_id is required",
        };
      }

      // Get OpenAI credentials
      const {
        credentials: { client_json },
      } = await CredentialManager.getCredentials(
        user_id,
        "openai",
        credential_id
      );

      const { apiKey } = client_json;

      // Resolve parameters
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const systemPrompt = resolvedParams.systemPrompt || node.values.systemPrompt || 
        "You are a helpful AI assistant. Use the available tools to help answer the user's questions.";
      const userPrompt = resolvedParams.userPrompt || node.values.userPrompt;
      const maxIterations = resolvedParams.maxIterations || node.values.maxIterations || 10;
      const temperature = resolvedParams.temperature || node.values.temperature || 0.7;
      const returnIntermediateSteps = resolvedParams.returnIntermediateSteps || 
        node.values.returnIntermediateSteps || false;
      const model = resolvedParams.model || node.values.model || "gpt-4o-mini";

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
        openAIApiKey: apiKey,
      });

      // Create tools from available nodes
      const tools = await this.createToolsFromNodes(node, context);

      console.log(`🛠️  [AIAgent] Created ${tools.length} tools`);

      // Create agent prompt
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", systemPrompt],
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
      ]);

      // Create agent
      const agent = await createOpenAIFunctionsAgent({
        llm,
        tools,
        prompt,
      });

      // Create agent executor
      const agentExecutor = new AgentExecutor({
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
          intermediateSteps: returnIntermediateSteps ? result.intermediateSteps : undefined,
          input: userPrompt,
        },
      };
    } catch (error: any) {
      console.error("❌ [AIAgent] Agent execution error:", error);
      return {
        success: false,
        error:
          error.message ||
          "AI Agent execution failed",
      };
    }
  }

  /**
   * Create LangChain tools from connected workflow nodes
   */
  private async createToolsFromNodes(
    agentNode: WorkflowNode,
    context?: any
  ): Promise<DynamicStructuredTool[]> {
    const tools: DynamicStructuredTool[] = [];

    // Get tool node IDs from the agent configuration
    const toolNodesStr = agentNode.values.toolNodes || "";
    const toolNodeIds = toolNodesStr
      .split(",")
      .map((id: string) => id.trim())
      .filter((id: string) => id.length > 0);

    if (toolNodeIds.length === 0) {
      console.log("⚠️  [AIAgent] No tool nodes specified");
      return tools;
    }

    // Get all nodes from context
    const allNodes = context?.nodes || [];

    for (const toolNodeId of toolNodeIds) {
      const toolNode = allNodes.find((n: WorkflowNode) => n.id === toolNodeId);
      if (!toolNode) {
        console.warn(`⚠️  [AIAgent] Tool node ${toolNodeId} not found`);
        continue;
      }

      // Create tool wrapper for this node
      const tool = this.createToolFromNode(toolNode, context);
      tools.push(tool);
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
          console.log(`🔧 [AIAgent] Executing tool: ${toolName} with input:`, input);

          // Get the executor for this node category
          const { getNodeExecutor } = await import("../registry");
          const executor = getNodeExecutor(node.category);

          if (!executor) {
            throw new Error(`No executor found for node category: ${node.category}`);
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
          console.error(`❌ [AIAgent] Tool ${toolName} execution error:`, error);
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
    return node.type.toLowerCase().replace(/[^a-z0-9_]/g, "_");
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
      descriptionMap[node.type] ||
      `Execute ${node.type} node to perform its configured action`
    );
  }

  /**
   * Generate a Zod schema for tool input based on node definition
   */
  private getToolSchema(node: WorkflowNode): z.ZodObject<any> {
    // For now, use a generic schema that accepts any input
    // In a more advanced implementation, you would parse the node's field definitions
    // and create a schema that matches the expected inputs
    return z.object({
      input: z.any().optional().describe("Input data for the tool"),
    });
  }
}
