import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { AgentExecutor, createOpenAIFunctionsAgent } from '@langchain/agents';
import { DynamicTool } from '@langchain/core/tools';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { supabase } from '../config/supabase';
import axios from 'axios';

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

export class AgentSystem {
  private static instance: AgentSystem;
  private sessions = new Map<string, AgentSession>();
  private tools: DynamicTool[] = [];
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

    this.tools = toolDefinitions.map(toolDef => 
      new DynamicTool({
        name: toolDef.name,
        description: toolDef.description,
        func: async (input: string) => {
          try {
            const params = JSON.parse(input);
            const context = this.getCurrentContext();
            return JSON.stringify(await toolDef.handler(params, context));
          } catch (error) {
            return JSON.stringify({ error: error.message });
          }
        }
      })
    );

    console.log(`🛠️ Initialized ${this.tools.length} agent tools`);
  }

  private getCurrentContext(): any {
    // This should be set during agent execution
    return { userId: 'current-user-id' }; // TODO: Implement proper context management
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

    // Add user message to session
    session.messages.push(new HumanMessage(message));

    try {
      // Create agent prompt
      const prompt = ChatPromptTemplate.fromMessages([
        [
          'system',
          `You are a helpful AI assistant for a trading and workflow platform. You can help users with:
          - Executing workflows
          - Getting market data and technical indicators
          - Managing trading operations
          - Sending notifications
          
          User context: ${JSON.stringify(session.context)}
          
          Always be helpful and provide clear, actionable responses.`
        ],
        new MessagesPlaceholder('chat_history'),
        ['human', '{input}'],
        new MessagesPlaceholder('agent_scratchpad')
      ]);

      // Create agent
      const agent = await createOpenAIFunctionsAgent({
        llm: this.llm,
        tools: this.tools,
        prompt
      });

      const agentExecutor = new AgentExecutor({
        agent,
        tools: this.tools,
        verbose: true,
        returnIntermediateSteps: true
      });

      // Execute agent
      const result = await agentExecutor.invoke({
        input: message,
        chat_history: session.messages.slice(0, -1) // Exclude the current message
      });

      // Add AI response to session
      session.messages.push(new AIMessage(result.output));

      // Keep only last 20 messages to prevent memory issues
      if (session.messages.length > 20) {
        session.messages = session.messages.slice(-20);
      }

      return result.output;
    } catch (error) {
      console.error(`Agent processing error for session ${sessionId}:`, error);
      throw new Error(`Agent processing failed: ${error.message}`);
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

  // Tool implementations
  private async executeWorkflowTool(params: any, context: any): Promise<any> {
    try {
      const { WorkflowEngine } = await import('./workflowEngine');
      const result = await WorkflowEngine.executeWorkflow(context.userId, params.workflowId, params.inputData || {});
      
      return {
        success: true,
        runId: result.runId,
        message: 'Workflow execution started successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || error.message
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
      return { success: false, error: error.message };
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
      return { success: false, error: error.message };
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
      return {
        success: false,
        error: error.message
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
      return {
        success: false,
        error: error.response?.data?.error || error.message
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
      return {
        success: false,
        error: error.message
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
