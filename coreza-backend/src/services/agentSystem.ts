import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { supabase } from '../config/supabase';

interface AgentSession {
  id: string;
  userId: string;
  context: Record<string, any>;
  messages: BaseMessage[];
  createdAt: Date;
  lastActivity: Date;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  handler: (params: any, context: any) => Promise<any>;
}

type AgentAction =
  | { action: 'respond'; response: string }
  | { action: 'tool'; toolName: string; toolInput?: any };

export class AgentSystem {
  private static instance: AgentSystem;
  private sessions = new Map<string, AgentSession>();
  private tools: ToolDefinition[] = [];
  private toolMap = new Map<string, ToolDefinition>();
  private llm: ChatOpenAI;

  private constructor() {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o-mini',
      temperature: 0.7,
      openAIApiKey: process.env.OPENAI_API_KEY
    });

    this.initializeTools();
    this.setupSessionCleanup();
  }

  static getInstance(): AgentSystem {
    if (!AgentSystem.instance) {
      AgentSystem.instance = new AgentSystem();
    }
    return AgentSystem.instance;
  }

  private initializeTools(): void {
    const toolDefinitions: ToolDefinition[] = [
      {
        name: 'execute_workflow',
        description: 'Execute a workflow by ID for the current user',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', description: 'The workflow ID to execute' },
            inputData: { type: 'object', description: 'Optional input data for the workflow' }
          },
          required: ['workflowId']
        },
        handler: this.executeWorkflowTool.bind(this)
      },
      {
        name: 'get_workflow_status',
        description: 'Get the status of a workflow run',
        parameters: {
          type: 'object',
          properties: {
            runId: { type: 'string', description: 'The workflow run ID' }
          },
          required: ['runId']
        },
        handler: this.getWorkflowStatusTool.bind(this)
      },
      {
        name: 'get_user_workflows',
        description: 'Get all workflows for the current user',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of workflows to return' }
          }
        },
        handler: this.getUserWorkflowsTool.bind(this)
      },
      {
        name: 'get_market_data',
        description: 'Get current market data for a symbol',
        parameters: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'The stock symbol (e.g., AAPL)' },
            exchange: { type: 'string', description: 'The exchange (e.g., NASDAQ)' }
          },
          required: ['symbol']
        },
        handler: this.getMarketDataTool.bind(this)
      },
      {
        name: 'calculate_indicator',
        description: 'Calculate technical indicators for a symbol',
        parameters: {
          type: 'object',
          properties: {
            indicator: { type: 'string', description: 'Indicator type (rsi, ema, macd, etc.)' },
            symbol: { type: 'string', description: 'The stock symbol' },
            period: { type: 'number', description: 'The calculation period' }
          },
          required: ['indicator', 'symbol']
        },
        handler: this.calculateIndicatorTool.bind(this)
      },
      {
        name: 'send_notification',
        description: 'Send a notification to the user',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['email', 'sms', 'push'], description: 'Notification type' },
            message: { type: 'string', description: 'The notification message' },
            subject: { type: 'string', description: 'Email subject (if type is email)' }
          },
          required: ['type', 'message']
        },
        handler: this.sendNotificationTool.bind(this)
      }
    ];

    this.tools = toolDefinitions;
    this.toolMap = new Map(toolDefinitions.map(tool => [tool.name, tool]));

    console.log(`🛠️ Initialized ${this.tools.length} agent tools`);
  }

  async createSession(userId: string, initialContext: Record<string, any> = {}): Promise<string> {
    const sessionId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const session: AgentSession = {
      id: sessionId,
      userId,
      context: initialContext,
      messages: [],
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(sessionId, session);
    
    console.log(`🤖 Created agent session ${sessionId} for user ${userId}`);
    return sessionId;
  }

  async processMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Agent session ${sessionId} not found`);
    }

    session.lastActivity = new Date();
    session.messages.push(new HumanMessage(message));

    const decisionSystemMessage = this.buildDecisionSystemPrompt(session);
    const decisionMessages: BaseMessage[] = [
      decisionSystemMessage,
      ...session.messages
    ];

    try {
      const decisionResponse = await this.llm.invoke(decisionMessages);
      const action = this.parseAgentAction(decisionResponse.content);

      if (!action || action.action === 'respond') {
          const reply =
            action?.response ??
            (this.extractText(decisionResponse.content) ||
              'I am here to help with your trading and workflow questions.');
        session.messages.push(new AIMessage(reply));
        this.trimSessionMessages(session);
        return reply;
      }

      const toolDef = this.toolMap.get(action.toolName);
      if (!toolDef) {
        const errorMessage = `Unknown tool requested: ${action.toolName}`;
        session.messages.push(new AIMessage(errorMessage));
        this.trimSessionMessages(session);
        return errorMessage;
      }

      try {
        const toolResult = await toolDef.handler(
          action.toolInput || {},
          session.context
        );

        const followUpSystem = this.buildResponseSystemPrompt(session);
        const followUpMessages: BaseMessage[] = [
          followUpSystem,
          ...session.messages,
          new HumanMessage(
            `Tool ${toolDef.name} result: ${JSON.stringify(
              toolResult
            )}. Use this information to respond to the user.`
          )
        ];

        const finalResponse = await this.llm.invoke(followUpMessages);
        const reply =
          this.extractText(finalResponse.content) ||
          'Operation completed successfully.';
        session.messages.push(new AIMessage(reply));
        this.trimSessionMessages(session);
        return reply;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown tool error';
        const failureMessage = `Tool ${toolDef.name} failed: ${message}`;
        session.messages.push(new AIMessage(failureMessage));
        this.trimSessionMessages(session);
        return failureMessage;
      }
    } catch (error) {
      console.error(`Agent processing error for session ${sessionId}:`, error);
      const message =
        error instanceof Error ? error.message : 'Agent processing failed';
      throw new Error(`Agent processing failed: ${message}`);
    }
  }

  async getSession(sessionId: string): Promise<AgentSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    console.log(`🗑️ Deleted agent session ${sessionId}`);
  }

  private setupSessionCleanup(): void {
    // Clean up inactive sessions every hour
    setInterval(() => {
      const now = new Date();
      const expiredSessions: string[] = [];

      this.sessions.forEach((session, sessionId) => {
        const inactiveTime = now.getTime() - session.lastActivity.getTime();
        const oneHour = 60 * 60 * 1000;

        if (inactiveTime > oneHour) {
          expiredSessions.push(sessionId);
        }
      });

      expiredSessions.forEach(sessionId => {
        this.sessions.delete(sessionId);
      });

      if (expiredSessions.length > 0) {
        console.log(`🧹 Cleaned up ${expiredSessions.length} expired agent sessions`);
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  private buildDecisionSystemPrompt(session: AgentSession): SystemMessage {
    const toolDescriptions = this.tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    return new SystemMessage(
      `You are a helpful AI assistant for a trading and workflow platform. You can help users with:
      - Executing workflows
      - Getting market data and technical indicators
      - Managing trading operations
      - Sending notifications

      User context: ${JSON.stringify(session.context)}

      Available tools:\n${toolDescriptions}

      If you need to call a tool, respond ONLY with JSON in the form {"action":"tool","toolName":"name","toolInput":{...}}.
      If you can answer directly, respond ONLY with JSON {"action":"respond","response":"your message"}.
      Always produce valid JSON.`
    );
  }

  private buildResponseSystemPrompt(session: AgentSession): SystemMessage {
    return new SystemMessage(
      `You are a helpful AI assistant for a trading and workflow platform.
      Provide clear, actionable responses using the user's context: ${JSON.stringify(
        session.context
      )}.`
    );
  }

  private extractText(content: any): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map(part => {
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part?.text === 'string') {
            return part.text;
          }
          if (part?.type === 'text' && typeof part?.text === 'string') {
            return part.text;
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  private parseAgentAction(content: any): AgentAction | null {
    const raw = this.extractText(content).trim();
    if (!raw) {
      return null;
    }
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (parsed?.action === 'tool' && typeof parsed.toolName === 'string') {
        return {
          action: 'tool',
          toolName: parsed.toolName,
          toolInput: parsed.toolInput || {}
        };
      }
      if (parsed?.action === 'respond' && typeof parsed.response === 'string') {
        return { action: 'respond', response: parsed.response };
      }
    } catch {
      return null;
    }
    return null;
  }

  private trimSessionMessages(session: AgentSession): void {
    if (session.messages.length > 20) {
      session.messages = session.messages.slice(-20);
    }
  }

  // Tool implementations
  private async executeWorkflowTool(params: any, context: any): Promise<any> {
    try {
      if (!context?.userId) {
        return { success: false, error: 'User context is missing' };
      }
      if (!params?.workflowId) {
        return { success: false, error: 'workflowId is required' };
      }

      const { data: workflow, error } = await supabase
        .from('workflows')
        .select('id, nodes, edges')
        .eq('id', params.workflowId)
        .eq('user_id', context.userId)
        .single();

      if (error || !workflow) {
        return { success: false, error: error?.message || 'Workflow not found' };
      }

      const { executeWorkflow } = await import('./workflowEngine');
      const runId = `agent_${Date.now()}`;
      const result = await executeWorkflow(
        runId,
        params.workflowId,
        context.userId,
        workflow.nodes || [],
        workflow.edges || [],
        { initialInput: params.inputData }
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Workflow execution failed'
        };
      }

      return {
        success: true,
        runId,
        result: result.result,
        message: 'Workflow execution started successfully'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message
      };
    }
  }

  private async getWorkflowStatusTool(params: any, context: any): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('*')
        .eq('id', params.runId)
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        status: data.status,
        startedAt: data.started_at,
        completedAt: data.completed_at,
        result: data.result,
        error: data.error_message
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private async getUserWorkflowsTool(params: any, context: any): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name, is_active, created_at')
        .eq('user_id', context.userId)
        .order('created_at', { ascending: false })
        .limit(params.limit || 10);

      if (error) {
        return { success: false, error: error.message };
      }

      return {
        success: true,
        workflows: data
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  private async getMarketDataTool(params: any, context: any): Promise<any> {
    try {
      const { DataService } = await import('./data');
      const result = await DataService.execute('market', 'get_quote', {
        symbol: params.symbol
      });
      
      return {
        success: result.success,
        data: result.data
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message
      };
    }
  }

  private async calculateIndicatorTool(params: any, context: any): Promise<any> {
    try {
      const { IndicatorService } = await import('./indicators');
      const result = await IndicatorService.calculate(params.indicator, {
        symbol: params.symbol,
        period: params.period || 14
      });
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      const message =
        (error as any)?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        error: message
      };
    }
  }

  private async sendNotificationTool(params: any, context: any): Promise<any> {
    try {
      // TODO: Implement notification sending through queue
      console.log(`📧 Sending ${params.type} notification to user ${context.userId}:`, params.message);
      
      return {
        success: true,
        message: 'Notification sent successfully'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message
      };
    }
  }

  getStats(): any {
    return {
      activeSessions: this.sessions.size,
      availableTools: this.tools.length,
      sessions: Array.from(this.sessions.values()).map(session => ({
        id: session.id,
        userId: session.userId,
        messageCount: session.messages.length,
        lastActivity: session.lastActivity
      }))
    };
  }
}

export default AgentSystem.getInstance();
