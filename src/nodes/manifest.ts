// JSON imports for node definitions
// Note: For now using placeholder objects until actual JSON files are created
const EmailDef = { name: "Email", def: "Email node definition", node_type: "email", icon: "Mail", category: "Communication", description: "Send email notifications with trading signals", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }], fields: [] };
const OpenAiDef = { name: "OpenAI", def: "OpenAI node definition", node_type: "openai", icon: "Brain", category: "AI", description: "AI-powered market analysis and predictions", color: "text-purple-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const AgentDef = { name: "Agent", def: "Agent node definition", node_type: "agent", icon: "Bot", category: "AI", description: "Intelligent trading agent", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const ChatInputDef = { name: "Chat Input", def: "Chat Input node definition", node_type: "chatInput", icon: "MessageSquare", category: "Input", description: "Interactive chat interface for trading commands", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const FinnHubDef = { name: "FinnHub", def: "FinnHub node definition", node_type: "finnhub", icon: "Database", category: "Data", description: "Real-time financial market data from FinnHub", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const YahooFinanceDef = { name: "Yahoo Finance", def: "Yahoo Finance node definition", node_type: "yahooFinance", icon: "TrendingUp", category: "Data", description: "Market data and historical prices from Yahoo Finance", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const MovingAverageCrossDef = { name: "Moving Average Cross", def: "Moving Average Cross node definition", node_type: "movingAverageCross", icon: "Activity", category: "Indicators", description: "Moving average crossover strategy indicator", color: "text-orange-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const EMADef = { name: "EMA", def: "EMA node definition", node_type: "ema", icon: "TrendingUp", category: "Indicators", description: "Exponential Moving Average indicator", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const RSIDef = { name: "RSI", def: "RSI node definition", node_type: "rsi", icon: "BarChart3", category: "Indicators", description: "Relative Strength Index technical indicator", color: "text-purple-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const VisualizeDef = { name: "Visualize", def: "Visualize node definition", node_type: "visualize", icon: "BarChart3", category: "Visualization", description: "Chart and visualize trading data", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }], fields: [] };
const IfDef = { name: "If Condition", def: "If Condition node definition", node_type: "if", icon: "GitBranch", category: "Logic", description: "Conditional logic for trading decisions", color: "text-yellow-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "true" }, { type: "source", position: "right", id: "false" }], fields: [] };
const SchedulerDef = { name: "Scheduler", def: "Scheduler node definition", node_type: "scheduler", icon: "Calendar", category: "Triggers", description: "Time-based workflow triggers", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const AlpacaDataDef = { name: "Alpaca Data", def: "Alpaca Data node definition", node_type: "alpacaData", icon: "Database", category: "Data", description: "Get market data from Alpaca Markets", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const AlpacaTradeDef = { name: "Alpaca Trade", def: "Alpaca Trade node definition", node_type: "alpacaTrade", icon: "ShoppingCart", category: "Trading", description: "Execute trades through Alpaca Markets", color: "text-red-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }], fields: [] };
const IndicatorDef = { name: "Indicator", def: "Indicator node definition", node_type: "indicator", icon: "Target", category: "Indicators", description: "Custom technical indicator analysis", color: "text-purple-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };

// Node configuration interface
export interface NodeConfig {
  name: string;
  def: string;
  node_type: string;
  parentNode?: string;
  handles: { type: string; position: string; id: string }[];
  auth?: string;
  authFields?: {
    key: string;
    label: string;
    type: string;
    value?: string;
    default?: string;
    placeholder?: string;
  }[]; 
  authAction?: { url: string; method: string };  
  icon: string;
  size: { width: number; height: number };
  action?: { url: string; method: string };
  fields: {
    key: string;
    label: string;
    type: string;
    subFields?: {
      key: string;
      type: string;
      options?: {
        label: string;
        value: string;
      }[];
      placeholder?: string;
    }[];
    optionsSource?: string;
    required: boolean;
    placeholder?: string;
  }[];
}

export const nodeManifest = [
  { type: EmailDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: EmailDef },
  
  { type: OpenAiDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: OpenAiDef },

  { type: AgentDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: AgentDef },

  { type: ChatInputDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: ChatInputDef },

  { type: FinnHubDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: FinnHubDef },
  
  { type: YahooFinanceDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: YahooFinanceDef },

  { type: MovingAverageCrossDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: MovingAverageCrossDef },

  { type: RSIDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: RSIDef },
  
  { type: EMADef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: EMADef },
  
  { type: IfDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: IfDef },
  
  { type: VisualizeDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: VisualizeDef },

  { type: SchedulerDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: SchedulerDef },

  { type: AlpacaDataDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: AlpacaDataDef },
  
  { type: AlpacaTradeDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: AlpacaTradeDef },
  
  { type: IndicatorDef.name, 
    loader: () => import('@/components/nodes/GenericNode'), 
    config: IndicatorDef }
] as const;

export type ManifestEntry = typeof nodeManifest[number];