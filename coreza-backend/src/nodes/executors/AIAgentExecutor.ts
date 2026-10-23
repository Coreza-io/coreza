/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { randomUUID } from "crypto";
import { AsyncLocalStorage } from 'async_hooks';
import { AgentActivityRecorder, assertAgentActive } from "../../agents/activity";
import {
  buildExecutorCategoryMap,
  isBrokerNode,
} from "../../brokers/capabilities";
import { DynamicStructuredTool, ToolInputParsingException } from "@langchain/core/tools";
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

import { createAgent } from "langchain";
import {
  AIMessage,
  BaseMessage,
  SystemMessage,
  HumanMessage,
} from "@langchain/core/messages";
import CredentialManager from "../../utils/credentialManager";
import { z, ZodTypeAny } from "zod";
import {
  processToolOutput,
  resolveDataRef,
  ToolInvocationRefs,
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
} from "../../utils/normalizeOutput";
import { getLLM, LLMConfig } from "../../config/llmProviders";
import { isSolModel, resolveSolEffort } from '../../config/openAIModelCapabilities';
import { loadMemoryFromEdges, acquireMemoryConversation } from "../logic/memoryLoader";
import { getFieldValueMode, parameterEntries } from "../../utils/fieldValueModes";
import { createToolExecutionTrace, safeToolError, toolInputFields, toolResultSummary } from "../../utils/toolExecutionLog";
import type { ToolExecutionTrace } from "../../utils/toolExecutionLog";

const isConfiguredToolValue = (value: unknown): boolean => value !== undefined && value !== null
  && (typeof value !== "string" || value.trim() !== "")
  && (!Array.isArray(value) || value.length > 0);

export class AIAgentExecutor implements INodeExecutor {
  readonly category = "AIAgent";
  private readonly brokerCategories = buildExecutorCategoryMap();

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const started = performance.now();
    // Copy invocation identity; the workflow runtime reuses its mutable context.
    const executionId = String(context?.executionId || context?.runId || randomUUID());
    const workflowId = String(context?.workflowId || "unknown");
    const userId = String(context?.userId || "unknown");
    const signal: AbortSignal | undefined = context?.abortSignal;
    const activity = new AgentActivityRecorder({
      workflowId, workflowExecutionId: executionId, workflowRunId: context?.runId,
      agentNodeId: node.id, clientInvocationId: context?.clientInvocationId,
    }, context?.agentActivitySink);
    try { context?.onAgentActivityRecorder?.(activity); } catch { /* observer only */ }
    activity.start("agent", node.id);
    const dataContextManager = DataContextManager.getInstance();
    let dataContext: DataContext | undefined;
    let ownedContextId: string | undefined;
    let releaseMemory: (() => void) | undefined;
    let releaseContext: (() => void) | undefined;
    const toolLifetime: { active: number; closed: boolean; onDrained?: () => void } = { active: 0, closed: false };
    const invocationRefs = new ToolInvocationRefs();
    const heldConversations = new Set<string>(context?.agentMemoryConversations ?? []);
    let terminal: "completed" | "failed" | "cancelled" = "failed";
    try {
      assertAgentActive(signal);
      const borrowed = context?.dataContext as DataContext | undefined;
      if (borrowed) {
        if (borrowed.getUserId() !== userId || borrowed.getWorkflowId() !== workflowId)
          throw new Error("Agent DataContext ownership mismatch");
        dataContext = borrowed;
      } else {
        ownedContextId = `agent:${activity.invocationId}`;
        dataContext = dataContextManager.getContext({ executionId: ownedContextId, workflowId, userId });
      }
      releaseContext = dataContextManager.retainContext(dataContext);
      if (process.env.LOG_LEVEL === "debug") console.debug(
        `🤖 [AIAgent] Starting AI Agent execution for node ${node.id} (execution: ${executionId})`,
      );

      // Get user_id from context
      const user_id = context?.userId;
      if (!user_id) {
        const errOutput = createErrorOutput(
          "user_id is required for AI Agent execution",
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
        );
        return toNodeResult(errOutput);
      }

      const chatModelNode = allNodes.find(
        (n: WorkflowNode) => n.id === chatModelEdge.source,
      );
      if (!chatModelNode) {
        const errOutput = createErrorOutput(
          "Connected Chat Model node not found",
        );
        return toNodeResult(errOutput);
      }

      // Get credentials from the connected Chat Model node
      const credential_id = chatModelNode.values?.credential_id;
      if (!credential_id) {
        const errOutput = createErrorOutput(
          "Chat Model node must have credentials configured",
        );
        return toNodeResult(errOutput);
      }

      // Get provider from Chat Model node (supports OpenAI, Gemini, etc.)
      const providerId = chatModelNode.provider;
      const serviceType = chatModelNode.name?.toLowerCase?.();

      if (process.env.LOG_LEVEL === "debug") console.debug(
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
        );
        return toNodeResult(errOutput);
      }

      const apiKey = client_json.apiKey;
      if (!apiKey) {
        const errOutput = createErrorOutput(
          "Chat model credential is missing apiKey",
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
        const errOutput = createErrorOutput("userPrompt is required");
        return toNodeResult(errOutput);
      }

      const solModel = isSolModel(providerId, model);
      const isSearchModel = !solModel && chatModelNode.values?.isSearchModel === true;
      const isReasoningModel = solModel || chatModelNode.values?.supportsReasoning === true;
      const tokenSetting = chatModelNode.values?.maxTokens;

      const llmConfig: LLMConfig = {
        apiKey,
        model,
        maxTokens: solModel ? tokenSetting == null || tokenSetting === '' ? undefined : Number(tokenSetting)
          : tokenSetting ? Number(tokenSetting) : undefined,
        isSearchModel,
        isReasoningModel,
      };

      if (!isSearchModel && !isReasoningModel) {
        llmConfig.temperature = Number(resolvedParams.temperature);
      }

      if (isReasoningModel) {
        llmConfig.reasoningEffort =
          solModel ? resolveSolEffort(chatModelNode.values?.reasoningEffort) : chatModelNode.values?.reasoningEffort ?? "medium";
      }

      const llm = getLLM(providerId, llmConfig);

      if (process.env.LOG_LEVEL === "debug") console.debug(
        `🤖 [AIAgent] Created ${providerId} LLM with model: ${model}`,
      );

      // Create tools from connected tool nodes - pass dataContext
      const tools = await this.createToolsFromEdges(node, edges, allNodes, {
        ...context,
        dataContext,
        executionId,
        agentActivity: activity,
        agentToolLifetime: toolLifetime,
        invocationRefs,
        agentMemoryConversations: heldConversations,
        // Nested executors borrow this context but own their own invocation metadata.
        onAgentActivityRecorder: undefined,
      });

      if (process.env.LOG_LEVEL === "debug") console.debug(`🛠️  [AIAgent] Created ${tools.length} tools`);
      const memoryNodeId = edges.find((edge: any) => edge.target === node.id && edge.targetHandle === "memory")?.source;
      const prepareSpan = memoryNodeId ? activity.start("memory", memoryNodeId, "prepare") : undefined;
      let loadedMemory;
      try {
        loadedMemory = await loadMemoryFromEdges(node, edges, allNodes, { ...context, dataContext }, input);
        if (prepareSpan) activity.end(prepareSpan, "completed");
      } catch (error) {
        if (prepareSpan) activity.end(prepareSpan, signal?.aborted ? "cancelled" : "failed");
        throw error;
      }
      let priorMessages: BaseMessage[] = [];
      if (loadedMemory) {
        if (heldConversations.has(loadedMemory.conversationKey))
          throw new Error("Nested Agent cannot re-enter its parent's memory conversation");
        releaseMemory = await acquireMemoryConversation(loadedMemory.conversationKey, signal);
        heldConversations.add(loadedMemory.conversationKey);
        assertAgentActive(signal);
        const readSpan = activity.start("memory", memoryNodeId, "read");
        try {
          priorMessages = (await loadedMemory.history.getMessages()).slice(-loadedMemory.windowMessages);
          activity.end(readSpan, "completed");
        } catch (error) { activity.end(readSpan, signal?.aborted ? "cancelled" : "failed"); throw error; }
      }
      assertAgentActive(signal);
      const modelSpans = new Map<string, string>();
      const modelTimes = new Map<string, number>();
      const modelStart = (_model: unknown, _messages: unknown, runId: string) => {
        if (modelTimes.size < 128 && !modelTimes.has(runId)) modelTimes.set(runId, performance.now());
        if (modelSpans.size < 128 && !modelSpans.has(runId)) modelSpans.set(runId, activity.start("model", chatModelNode.id));
      };
      const modelEnd = (output: any, runId: string) => {
        const responseError = solModel ? this.solResponseError(output?.generations?.flat()?.map((generation: any) => generation.message) || []) : undefined;
        const start = modelTimes.get(runId);
        if (start !== undefined) console.info('[AIAgent] model', { runId: executionId, nodeId: node.id, modelInvocationId: runId, durationMs: performance.now() - start });
        modelTimes.delete(runId);
        const span = modelSpans.get(runId);
        if (span) activity.end(span, responseError ? "failed" : "completed");
        modelSpans.delete(runId);
        if (responseError) throw responseError;
      };
      const modelError = (_error: unknown, runId: string) => {
        const start = modelTimes.get(runId);
        if (start !== undefined) console.info('[AIAgent] model failed', { runId: executionId, nodeId: node.id, modelInvocationId: runId, durationMs: performance.now() - start });
        modelTimes.delete(runId);
        const span = modelSpans.get(runId);
        if (span) activity.end(span, signal?.aborted ? "cancelled" : "failed");
        modelSpans.delete(runId);
      };
      const modelActivity = BaseCallbackHandler.fromMethods({ handleChatModelStart: modelStart,
        handleLLMStart: modelStart, handleLLMEnd: modelEnd, handleLLMError: modelError });
      modelActivity.name = 'coreza-agent-activity';
      if (solModel) {
        // fromMethods assigns flags after construction; explicitly await validation
        // before the agent can dispatch tools, even with background callbacks enabled.
        modelActivity.raiseError = true;
        modelActivity.awaitHandlers = true;
      }

      // Create agent using the new LangChain agent API
      const agent = createAgent({
        model: llm,
        tools,
      });

      // Execute agent
      if (process.env.LOG_LEVEL === "debug") console.debug(`🚀 [AIAgent] Executing agent for node ${node.id}`);
      const result = await agent.invoke(
        {
          messages: [
            new SystemMessage(`${systemPrompt}\nHistorical market-data tools return a dataRef. Pass that exact dataRef to indicator tools in candle_data or dataRef; tool names are not storage keys. Never claim indicator confirmation from failed or not_ready tool results.`),
            ...priorMessages,
            new HumanMessage(userPrompt),
          ],
        },
        {
          recursionLimit: Number(maxIterations),
          signal,
          callbacks: [modelActivity],
        },
      );

      if (process.env.LOG_LEVEL === "debug") console.debug(`✅ [AIAgent] Agent execution completed`);

      if (process.env.LOG_LEVEL === "debug") {
        const stats = dataContext.getStats();
        console.debug(`📊 [AIAgent] Memory used: ${stats.entryCount} entries, ${(stats.totalSizeBytes / 1024 / 1024).toFixed(2)}MB`);
      }

      assertAgentActive(signal);
      const responseStart = performance.now();
      const agentOutput = solModel ? this.getSolAgentOutput(result) : this.getAgentOutput(result);
      console.info('[AIAgent] final response', { runId: executionId, nodeId: node.id, durationMs: performance.now() - responseStart });

      if (loadedMemory && agentOutput.trim()) {
        const writeSpan = activity.start("memory", memoryNodeId, "write");
        try {
          await loadedMemory.history.addMessages([
            new HumanMessage(String(userPrompt)), new AIMessage(agentOutput),
          ]);
          activity.end(writeSpan, "completed");
        } catch (error) { activity.end(writeSpan, signal?.aborted ? "cancelled" : "failed"); throw error; }
      }

      assertAgentActive(signal);
      terminal = "completed";
      const successOutput = createSuccessOutput(agentOutput);
      return toNodeResult(successOutput);
    } catch (error: any) {
      if (signal?.aborted || error?.name === "AbortError") {
        terminal = "cancelled";
        throw error;
      }
      createToolExecutionTrace({ runId: executionId, agentInvocationId: activity.invocationId, workflowNodeId: node.id })
        ('agent_error', () => ({ status: 'failed', failure: safeToolError(error) }));
      const errOutput = createErrorOutput(
        error.message || "AI Agent execution failed",
      );
      return toNodeResult(errOutput);
    } finally {
      toolLifetime.closed = true;
      activity.finish(terminal);
      const cleanup = () => {
        const cleanupStart = performance.now();
        releaseMemory?.();
        // Owner disposal can be requested while a borrower is still draining.
        if (ownedContextId) dataContextManager.destroyContext(ownedContextId);
        releaseContext?.();
        invocationRefs.clear();
        console.info('[AIAgent] cleanup', { runId: executionId, nodeId: node.id, durationMs: performance.now() - cleanupStart, totalMs: performance.now() - started, state: terminal });
      };
      // LangGraph can abort its wait before an uncancellable tool settles.
      // Keep its DataRefs and conversation lock alive until the actual boundary ends.
      if (toolLifetime.active) toolLifetime.onDrained = cleanup;
      else cleanup();
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
      if (process.env.LOG_LEVEL === "debug") console.debug("⚠️  [AIAgent] No tool nodes connected");
      return tools;
    }

    if (process.env.LOG_LEVEL === "debug") console.debug(`🔍 [AIAgent] Found ${toolEdges.length} tool connections`);

    const usedNames = new Set<string>();
    const attachedIds = new Set<string>();
    for (const toolEdge of toolEdges) {
      if (attachedIds.has(toolEdge.source)) continue;
      attachedIds.add(toolEdge.source);
      const toolNode = allNodes.find(
        (n: WorkflowNode) => n.id === toolEdge.source,
      );
      if (!toolNode) {
        console.warn(`⚠️  [AIAgent] Tool node ${toolEdge.source} not found`);
        continue;
      }

      // Create tool wrapper for this node
      const isToggled = (toolNode as any).__isTool === true;
      const baseName = this.getToolName(toolNode).slice(0, 54) || "tool";
      let toolName = baseName;
      let suffix = 2;
      while (usedNames.has(toolName)) toolName = `${baseName}_${suffix++}`;
      usedNames.add(toolName);
      const tool = this.createToolFromNode(toolNode, context, toolName);
      tools.push(tool);
      if (process.env.LOG_LEVEL === "debug") console.debug(
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
    toolName = this.getToolName(node),
  ): DynamicStructuredTool {
    const definition = this.getToolDefinition(node);
    const configuredValues = Object.fromEntries(
      parameterEntries(node.values ?? {}).filter(([, value]) => isConfiguredToolValue(value)),
    );
    const toolDescription = `${this.getToolDescription(node, definition)}${
      configuredValues.operation ? ` Configured operation: ${configuredValues.operation}.` : ""
    } Only supply the exposed, unconfigured fields. Saved node settings are fixed.`;
    const toolSchema = this.getToolSchema(node, definition);
    const dataContext = context?.dataContext as DataContext | undefined;
    const executorCategory = this.getExecutorCategory(node, definition);
    const makeTrace = (toolInvocationId: string) => createToolExecutionTrace({
      runId: context?.runId || context?.executionId, agentInvocationId: context?.agentActivity?.invocationId,
      toolInvocationId, workflowNodeId: node.id, workflowNodeName: (node as any).displayName || node.id,
      toolName, executorCategory,
    });
    // Observe pre-schema arguments without changing schemas, arguments or model-facing results.
    const invocationLogInput = new AsyncLocalStorage<{ input: unknown }>();
    const unwrapLogInput = (raw: any) => raw?.input && typeof raw.input === 'object' && !Array.isArray(raw.input)
      ? Object.fromEntries(Object.entries({ ...raw, ...raw.input }).filter(([key]) => key !== 'input')) : raw;

    const tool = new DynamicStructuredTool<any, any, string>({
      name: toolName,
      description: toolDescription,
      schema: toolSchema as ZodTypeAny,
      func: async (input: Record<string, any>) => {
        const toolInvocationId = randomUUID();
        const started = performance.now();
        const refs = context?.invocationRefs as ToolInvocationRefs | undefined;
        refs?.begin(toolInvocationId, toolName, node.id);
        const emitTrace = makeTrace(toolInvocationId);
        let requestCount = 0;
        const trace: ToolExecutionTrace = (phase, fields, level) => {
          if (phase === 'http_request') requestCount++;
          emitTrace(phase, fields, level);
        };
        let status = 'failed';
        let operation = configuredValues.operation;
        let completion: Record<string, unknown> = {};
        trace('tool_started', { operation, status: 'started' });
        const activity = context?.agentActivity as AgentActivityRecorder | undefined;
        const span = activity?.start("tool", node.id);
        const lifetime = context?.agentToolLifetime as { active: number; closed: boolean; onDrained?: () => void } | undefined;
        if (lifetime) lifetime.active++;
        const ensureActive = () => {
          assertAgentActive(context?.abortSignal);
          if (lifetime?.closed) { const error = new Error("Agent invocation ended"); error.name = "AbortError"; throw error; }
        };
        try {
          ensureActive();
          if (process.env.LOG_LEVEL === "debug") console.debug(`🔧 [AIAgent] Executing tool: ${toolName}`);

          // Unwrap nested input if agent sends { input: { ... } } wrapper
          const generatedInput = input.input && typeof input.input === "object" && !Array.isArray(input.input)
            ? { ...input, ...input.input } : input;
          if (generatedInput !== input) delete generatedInput.input;
          trace('generated_input', () => ({ source: invocationLogInput.getStore() ? 'generated' : 'validated',
            fields: toolInputFields(unwrapLogInput(invocationLogInput.getStore()?.input ?? generatedInput),
            executorCategory === 'Broker' ? operation || generatedInput.operation || '__broker_unknown__' : undefined) }), 'debug');
          trace('validated_input', () => ({ source: 'schema', fields: toolInputFields(generatedInput,
            executorCategory === 'Broker' ? operation || generatedInput.operation || '__broker_unknown__' : undefined) }), 'debug');
          trace('configured_input', () => ({ source: 'configured', fields: toolInputFields(configuredValues,
            executorCategory === 'Broker' ? operation || generatedInput.operation || '__broker_unknown__' : undefined) }), 'debug');
          // Apply the same authoritative values to both executor inputs. Blank saved
          // fields must not erase generated arguments; configured fields always win.
          const suppliedInput = { ...generatedInput, ...configuredValues };
          // Workflow resolvers may use a precompiled snapshot of this tool node.
          // Resolve saved expressions there, but copy back only configured keys:
          // its original blank values must not replace generated arguments.
          const resolvedValues = context?.resolveNodeParameters
            ? context.resolveNodeParameters(node, suppliedInput) : configuredValues;
          const resolvedConfigured = Object.fromEntries(Object.entries(configuredValues).map(([key, value]) =>
            [key, Object.prototype.hasOwnProperty.call(resolvedValues, key) ? resolvedValues[key] : value],
          ));
          const referenceStart = performance.now();
          const effectiveInput = { ...generatedInput, ...resolvedConfigured };
          const unwrappedInput = executorCategory === 'Indicators' ? effectiveInput
            : resolveDataRef(effectiveInput, dataContext, refs);
          operation = unwrappedInput.operation;
          trace('effective_input', () => ({ operation, source: 'effective',
            fields: toolInputFields(unwrappedInput, executorCategory === 'Broker' ? operation || '__broker_unknown__' : undefined),
            resolution: {
              overriddenValidatedKeys: Object.keys(configuredValues).filter(key => Object.prototype.hasOwnProperty.call(generatedInput, key)),
              expressionChangedKeys: Object.keys(resolvedConfigured).filter(key => resolvedConfigured[key] !== configuredValues[key]),
              referenceChangedKeys: Object.keys(unwrappedInput).filter(key => unwrappedInput[key] !== effectiveInput[key]),
            } }), 'debug');
          trace('resolve_input', { durationMs: performance.now() - referenceStart });
          const toolContext = {
            ...context,
            // A fetched historical snapshot must not consume or advance workflow live state.
            indicatorStateManager: executorCategory === 'Indicators' &&
              !['initializeindicators', 'rollingwindow'].includes(String(node.name).toLowerCase())
              ? undefined : context?.indicatorStateManager,
            agentDataTrace: trace,
            resolveNodeParameters: (current: WorkflowNode, currentInput: NodeInput) =>
              current.id === node.id ? { ...unwrappedInput }
                : context?.resolveNodeParameters ? context.resolveNodeParameters(current, currentInput)
                : { ...current.values, ...currentInput },
          };

          // Normalize node name for underlying executor (strip "Tool" suffix)
          const normalizedNode = {
            ...node,
            name: node.name,
            values: { ...unwrappedInput },
          };

          // Get the executor for this node category
          const { getNodeExecutor } = await import("../registry");
          const executor = getNodeExecutor(executorCategory);

          if (!executor) {
            throw new Error(
              `No executor found for node category: ${executorCategory}`,
            );
          }

          // Cancellation may have arrived during asynchronous executor discovery.
          ensureActive();
          // Execute the normalized node with unwrapped input
          const executeStart = performance.now();
          const result = await executor.execute(
            normalizedNode,
            unwrappedInput,
            toolContext,
          );
          ensureActive();
          trace('execute', { durationMs: performance.now() - executeStart, success: result.status === "success" });
          trace('executor_result', () => ({ operation, success: result.status === "success",
            result: toolResultSummary(result.data, executorCategory === 'Indicators') }));

          if (result.status === "error") {
            throw new Error(result.error || "Tool execution failed");
          }

          if (executorCategory === 'Indicators' && result.data?.IsReady === false) {
            status = 'not_ready';
            if (span) activity?.end(span, 'completed');
            return JSON.stringify({ success: true, status: 'not_ready', type: 'indicator', toolInvocationId,
              summary: { observedBars: result.data.SampleCount, requiredBars: result.meta?.requiredBars,
                reason: result.meta?.readinessReason }, cached: false });
          }

          if (process.env.LOG_LEVEL === "debug") console.debug(`✅ [AIAgent] Tool ${toolName} execution completed`);

          // Workflow outputs retain their legacy placeholders; the LLM must not
          // interpret an unavailable previous sample as a real zero/crossover.
          const outputData = executorCategory === 'Indicators' && result.data?.IsReady === true &&
            (result.meta?.series?.length === 1 || (typeof result.meta?.requiredBars === "number" && result.data.SampleCount <= result.meta.requiredBars))
            ? { ...result.data, Previous: null, previousValue: null } : result.data;
          // Process output through dataRef pattern (use normalized name for matching)
          const processedOutput = processToolOutput(
            normalizedNode.name || node.category || "",
            node.category || "",
            outputData,
            dataContext,
            unwrappedInput, // Pass tool input so symbol can be extracted
            trace,
          );
          if (processedOutput.dataRef) {
            refs?.complete(toolInvocationId, processedOutput.dataRef, processedOutput.summary);
            refs?.validatedBars.add(dataContext!.getDataByKey(processedOutput.dataRef));
          }

          // Include output processing/serialization in the actual tool boundary.
          const serialized = JSON.stringify({ ...processedOutput, toolInvocationId });
          assertAgentActive(context?.abortSignal);
          status = processedOutput.success === false ? processedOutput.status || 'failed' : 'success';
          completion = { dataRef: processedOutput.dataRef, rowCount: processedOutput.rowCount, resultType: processedOutput.type };
          if (span) activity?.end(span, processedOutput.success === false ? "failed" : "completed");
          return serialized;
        } catch (error: any) {
          const cancelled = context?.abortSignal?.aborted || error?.name === "AbortError";
          status = cancelled ? 'cancelled' : 'failed';
          trace('tool_error', () => ({ operation, status, failure: safeToolError(error) }));
          if (span) activity?.end(span, cancelled ? "cancelled" : "failed");
          if (cancelled) throw error;
          return JSON.stringify({ success: false, type: 'tool_error', toolInvocationId,
            error: { message: error.message || 'Tool execution failed' } });
        } finally {
          trace('tool_completed', () => ({ ...completion, operation, status,
            success: status === 'success' || status === 'not_ready', requestCount, durationMs: performance.now() - started }));
          if (lifetime && --lifetime.active === 0) {
            const cleanup = lifetime.onDrained;
            lifetime.onDrained = undefined;
            cleanup?.();
          }
        }
      },
    });
    // LangChain validates schemas before starting tool callbacks or entering func.
    const invoke = tool.invoke.bind(tool);
    tool.invoke = async (input, config) => {
      const started = performance.now();
      // Match LangChain's ToolCall discriminator; ordinary schemas may have an args field.
      const generatedInput = typeof input === 'object' && input && 'type' in input && input.type === 'tool_call'
        ? input.args : input;
      try { return await invocationLogInput.run({ input: generatedInput }, () => invoke(input, config)); }
      catch (error) {
        if (error instanceof ToolInputParsingException) {
          const trace = makeTrace(randomUUID());
          trace('tool_started', { operation: configuredValues.operation, status: 'started' });
          trace('tool_validation_failed', () => ({ status: 'failed', success: false, failure: safeToolError(error) }));
          trace('generated_input', () => ({ source: 'generated', fields: toolInputFields(
            generatedInput,
            executorCategory === 'Broker' ? configuredValues.operation || '__broker_unknown__' : undefined) }), 'debug');
          trace('configured_input', () => ({ source: 'configured', fields: toolInputFields(configuredValues,
            executorCategory === 'Broker' ? configuredValues.operation || '__broker_unknown__' : undefined) }), 'debug');
          trace('tool_completed', () => ({ operation: configuredValues.operation, status: 'failed',
            success: false, requestCount: 0, durationMs: performance.now() - started }));
          const activity = context?.agentActivity as AgentActivityRecorder | undefined;
          const span = activity?.start("tool", node.id);
          if (span) activity?.end(span, context?.abortSignal?.aborted ? "cancelled" : "failed");
        }
        throw error;
      }
    };
    return tool;
  }

  /**
   * Generate a tool name from a node
   */
  private getToolName(node: WorkflowNode): string {
    const metadataName =
      (node as any).toolMetadata?.name ||
      loadNodeDefinition(node.name || "")?.toolMetadata?.name;
    const rawName = metadataName || node.name || node.category || `node_${node.id}`;
    return rawName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }

  /**
   * Generate a tool description from a node
   */
  private getToolDescription(
    node: WorkflowNode,
    definition?: ToolDefinition,
  ): string {
    const metadataDescription =
      (node as any).toolMetadata?.description ||
      loadNodeDefinition(node.name || "")?.toolMetadata?.description;
    if (metadataDescription) {
      return metadataDescription;
    }

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
      case "number": {
        let numberType = z.coerce.number();
        if (typeof field.min === "number") numberType = numberType.min(field.min);
        if (typeof field.max === "number") numberType = numberType.max(field.max);
        zodType = numberType;
        break;
      }
      case "select": {
        const options = field.options?.map((o: any) => o.id || o.value) || [];
        if (options.length > 0) {
          zodType = z.enum(options as [string, ...string[]]);
        } else {
          zodType = z.string();
        }
        break;
      }
      case "checkbox":
        zodType = z.boolean();
        break;
      case "text":
      case "password":
      case "textarea":
      default:
        zodType = z.string();
        if (field.required) zodType = z.string().trim().min(1);
    }

    const desc = [field.label, field.description, field.placeholder].filter(Boolean).join(". ");
    if (desc) {
      zodType = zodType.describe(desc);
    }

    if (!field.required) {
      zodType = zodType.optional();
    }
    // Apply defaults after optional(), so omitted optional fields receive them.
    if (field.default !== undefined) {
      const defaultValue = field.type === "number" ? Number(field.default)
        : field.type === "checkbox" ? field.default === true || field.default === "true"
        : field.type === "select" ? field.default : String(field.default);
      zodType = zodType.default(defaultValue);
    }

    return zodType;
  }

  private generateSchemaFromNode(node: WorkflowNode): ZodTypeAny {
    const fields = (node as any).fields || [];
    const schemaObject: Record<string, ZodTypeAny> = {};

    for (const field of fields) {
      if (field.type === "hidden") continue;
      if (field.key === "credential_id") continue;
      if (isConfiguredToolValue(node.values?.[field.key])) continue;
      // A configured operation/asset type also fixes which dependent fields apply.
      const matches = (key: string, raw: any, hide = false): boolean => {
        const allowed = Array.isArray(raw) ? raw : [raw];
        const current = node.values?.[key];
        if (hide) return allowed.some(value => String(current) === String(
          value && typeof value === "object" ? value.id || value.value : value,
        ));
        return Array.isArray(current) ? current.some(value => allowed.includes(value)) : allowed.includes(current);
      };
      if (Object.entries(field.displayOptions?.show ?? {}).some(([key, allowed]) =>
        isConfiguredToolValue(node.values?.[key]) && getFieldValueMode(node.values ?? {}, key) === "fixed"
          && !matches(key, allowed))) continue;
      if (Object.entries(field.displayOptions?.hide ?? {}).some(([key, allowed]) =>
        isConfiguredToolValue(node.values?.[key]) && getFieldValueMode(node.values ?? {}, key) === "fixed"
          && matches(key, allowed, true))) continue;

      schemaObject[field.key] = field.key === 'candle_data' && node.category === 'Indicators'
        ? this.fieldToZodType({ ...field, required: false, description: 'Canonical candles as JSON, or the exact dataRef returned by a historical tool. Optional when dataRef is supplied.' })
        : this.fieldToZodType(field);
    }

    const nodeCategory = (node as any).subCategory || node.category || "";
    const nodeName = node.name || "";

    if (!isConfiguredToolValue(node.values?.dataRef) && (
      nodeCategory.includes("Indicator") ||
      nodeCategory.includes("Market") ||
      nodeCategory.includes("Broker") ||
      isBrokerNode(nodeName) ||
      nodeName.includes("Finance") ||
      nodeName.includes("Polygon") ||
      nodeName.includes("FinnHub")
    )) {
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
        if (process.env.LOG_LEVEL === "debug") console.debug(
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
        if (process.env.LOG_LEVEL === "debug") console.debug(
          `📋 [AIAgent] Tool ${node.name} schema keys:`,
          Object.keys((schema as any).shape || {}),
        );
      }

      return schema;
    }

    if (definition && definition.schema) {
      if (definition.schema instanceof z.ZodObject) {
        const fixed = Object.fromEntries(Object.entries(node.values ?? {})
          .filter(([, value]) => isConfiguredToolValue(value)).map(([key]) => [key, true]));
        return definition.schema.omit(fixed);
      }
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

    // Build broker-related categories from registry (config-driven)
    const brokerCategories = this.brokerCategories;

    const executorCategoryMap: Record<string, string> = {
      // Market data providers (non-broker)
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
      ATR: "Indicators",
      Stoch: "Indicators",
      Ichimoku: "Indicators",
      OBV: "Indicators",
      VWAP: "Indicators",
      VolumeOscillator: "Indicators",
      SupportResistance: "Indicators",

      // Utilities / tools
      GoogleWebSearch: "Tool",
      HttpRequest: "Utility",
      DocumentExtract: "Document",
      Math: "ControlFlow",
      Transform: "ControlFlow",
      Date: "ControlFlow",
      Field: "ControlFlow",

      // Broker-related entries (auto-generated from capabilities registry)
      ...brokerCategories,
    };

    return (
      executorCategoryMap[nodeName] ||
      definition?.category ||
      node.category ||
      "Utility"
    );
  }

  private solResponseError(messages: any[]): Error | undefined {
    for (const message of messages) {
      const metadata = message?.response_metadata;
      if (metadata?.status === 'incomplete') {
        return new Error(metadata.incomplete_details?.reason === 'max_output_tokens'
          ? 'GPT-6.1 Sol reached maxTokens before completing its response. Increase Max Tokens and review any completed tool activity before rerunning.'
          : 'GPT-6.1 Sol returned an incomplete response. Review completed tool activity before rerunning.');
      }
      if (metadata?.status && metadata.status !== 'completed') return new Error('GPT-6.1 Sol did not complete its response');
    }
    return undefined;
  }

  private getSolAgentOutput(result: any): string {
    const message = result?.messages?.at(-1);
    const error = this.solResponseError(message ? [message] : []);
    if (error) throw error;
    const type = message?._getType?.() ?? message?.role ?? message?.type;
    if (!['ai', 'assistant'].includes(type) || message?.tool_calls?.length || message?.invalid_tool_calls?.length) {
      throw new Error('GPT-6.1 Sol did not return a final assistant response');
    }
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content)
      ? message.content.filter((block: any) => ['text', 'output_text'].includes(block?.type) && typeof block.text === 'string')
        .map((block: any) => block.text).join('') : '';
    if (!text.trim()) throw new Error('GPT-6.1 Sol returned no final text. Check Max Tokens or provider refusal details before rerunning.');
    return text;
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
