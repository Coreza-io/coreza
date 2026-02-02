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
import {
  processToolOutput,
  resolveDataRef,
} from "../../services/toolOutputProcessor";
import { DataContext, DataContextManager } from "../../services/DataContext";
import {
  TOOL_DEFINITIONS,
  ToolDefinition,
} from "../../services/toolDefinitions";
import { loadNodeDefinition } from "../nodeDefinitions";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  NormalizeContext,
} from "../../utils/normalizeOutput";
import { isSearchModel } from "../../utils/openaiModels";

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
      category: this.category,
      startTime,
    };

    // Create DataContext for this agent execution
    const runId = context?.runId || `agent-${node.id}-${Date.now()}`;
    const workflowId = context?.workflowId || "unknown";
    const userId = context?.user_id || context?.userId || "unknown";

    const dataContextManager = DataContextManager.getInstance();
    const dataContext = dataContextManager.getContext({
      runId,
      workflowId,
      userId,
    });

    try {
      console.log(
        `🤖 [AIAgent] Starting AI Agent execution for node ${node.id} (run: ${runId})`,
      );

      // Get user_id from context
      const user_id = context?.user_id || context?.userId;
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

      const credentialResponse = await CredentialManager.getCredentials(
        user_id,
        "openaichatmodel",
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

      const { apiKey } = client_json;
      if (!apiKey) {
        const errOutput = createErrorOutput(
          "Chat model credential is missing apiKey",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
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
        const errOutput = createErrorOutput(
          "userPrompt is required",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      // Initialize LLM
      const llmConfig: {
        modelName: string;
        apiKey: string;
        temperature?: number;
      } = {
        modelName: model,
        apiKey: apiKey,
      };

      if (!isSearchModel(model)) {
        llmConfig.temperature = Number(temperature);
      }

      const llm = new ChatOpenAI(llmConfig);

      // Create tools from connected tool nodes - pass dataContext
      const tools = await this.createToolsFromEdges(node, edges, allNodes, {
        ...context,
        dataContext,
      });

      console.log(`🛠️  [AIAgent] Created ${tools.length} tools`);

      // Build tool list for enhanced system prompt
      const toolList = tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");

      // Enhance system prompt with tool listing and intelligent parameter guidance
      const enhancedSystemPrompt = `${systemPrompt}

AVAILABLE TOOLS (use ALL of them for comprehensive analysis):
${toolList}

CRITICAL INSTRUCTIONS:
- For each tool, DO NOT just use default values blindly
- ANALYZE the fetched data first (price range, volatility, data points count)
- CALCULATE appropriate parameter values based on:
  * The amount of data available (more data = can use longer lookbacks)
  * The stock's volatility (check daily % moves in the data)
  * The user's analysis timeframe (short-term vs long-term)
  * The specific question being asked
- EXPLAIN your parameter choices in your final response`;

      // Create agent prompt with enhanced system prompt
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", enhancedSystemPrompt],
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

      // Log memory stats
      const stats = dataContext.getStats();
      console.log(
        `📊 [AIAgent] Memory used: ${stats.entryCount} entries, ${(
          stats.totalSizeBytes /
          1024 /
          1024
        ).toFixed(2)}MB`,
      );

      const successOutput = createSuccessOutput(result.output, normalizeCtx);
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
      dataContextManager.destroyContext(runId);
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
            name: node.name?.endsWith("Tool")
              ? node.name.replace(/Tool$/, "")
              : node.name,
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
        zodType = z.number();
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
      nodeName.includes("Market") ||
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
      const normalizedName = nodeName.endsWith("Tool")
        ? nodeName.replace(/Tool$/, "")
        : nodeName;

      // Try to find the Tool definition first, then the base node
      const toolDefName = `${normalizedName}Tool`;
      let nodeDefinition = loadNodeDefinition(toolDefName);

      if (!nodeDefinition || !nodeDefinition.fields?.length) {
        nodeDefinition = loadNodeDefinition(normalizedName);
      }

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
    const normalizedName = nodeName.endsWith("Tool")
      ? nodeName.replace(/Tool$/, "")
      : nodeName;
    return TOOL_DEFINITIONS[normalizedName];
  }

  private getExecutorCategory(
    node: WorkflowNode,
    definition?: ToolDefinition,
  ): string {
    const nodeName = node.name || node.category || "node";
    const normalizedName = nodeName.endsWith("Tool")
      ? nodeName.replace(/Tool$/, "")
      : nodeName;

    const executorCategoryMap: Record<string, string> = {
      // Market data providers
      YahooFinance: "DataSource",
      FinnHub: "DataSource",
      Polygon: "DataSource",
      Market: "Market",
      Alpaca: "Market",
      Binance: "Market",
      Schwab: "Market",
      Dhan: "Market",

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

      // Brokers
      AlpacaTrade: "Broker",
      BinanceTrade: "Broker",
      DhanTrade: "Broker",
      SchwabTrade: "Broker",

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
      executorCategoryMap[normalizedName] ||
      definition?.category ||
      node.category ||
      "Utility"
    );
  }
}
