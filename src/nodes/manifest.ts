import { 
  Database, 
  TrendingUp, 
  GitBranch, 
  ShoppingCart, 
  Bell,
  BarChart3,
  Zap,
  DollarSign,
  Mail,
  Brain,
  MessageSquare,
  Calendar,
  Activity,
  Bot,
  Target,
  Play
} from "lucide-react";

// Node configuration interface
export interface NodeConfig {
  name: string;
  description: string;
  icon: string;
  category: string;
  color: string;
  node_type: string;
  size: { width: number; height: number };
  handles: { type: string; position: string; id: string }[];
  fields?: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
  }[];
}

// Node manifest with actual trading/finance nodes
export const nodeManifest: NodeConfig[] = [
  {
    name: "Email",
    description: "Send email notifications with trading signals",
    icon: "Mail",
    category: "Communication",
    color: "text-blue-500",
    node_type: "email",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" }
    ]
  },
  {
    name: "OpenAI",
    description: "AI-powered market analysis and predictions",
    icon: "Brain",
    category: "AI",
    color: "text-purple-500",
    node_type: "openai",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "Chat Input",
    description: "Interactive chat interface for trading commands",
    icon: "MessageSquare",
    category: "Input",
    color: "text-green-500",
    node_type: "chatInput",
    size: { width: 200, height: 120 },
    handles: [
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "FinnHub",
    description: "Real-time financial market data from FinnHub",
    icon: "Database",
    category: "Data",
    color: "text-blue-500",
    node_type: "finnhub",
    size: { width: 200, height: 120 },
    handles: [
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "Yahoo Finance",
    description: "Market data and historical prices from Yahoo Finance",
    icon: "TrendingUp",
    category: "Data",
    color: "text-green-500",
    node_type: "yahooFinance",
    size: { width: 200, height: 120 },
    handles: [
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "Moving Average Cross",
    description: "Moving average crossover strategy indicator",
    icon: "Activity",
    category: "Indicators",
    color: "text-orange-500",
    node_type: "movingAverageCross",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "RSI",
    description: "Relative Strength Index technical indicator",
    icon: "BarChart3",
    category: "Indicators",
    color: "text-purple-500",
    node_type: "rsi",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "EMA",
    description: "Exponential Moving Average indicator",
    icon: "TrendingUp",
    category: "Indicators",
    color: "text-blue-500",
    node_type: "ema",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "If Condition",
    description: "Conditional logic for trading decisions",
    icon: "GitBranch",
    category: "Logic",
    color: "text-yellow-500",
    node_type: "if",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "true" },
      { type: "source", position: "right", id: "false" }
    ]
  },
  {
    name: "Visualize",
    description: "Chart and visualize trading data",
    icon: "BarChart3",
    category: "Visualization",
    color: "text-green-500",
    node_type: "visualize",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" }
    ]
  },
  {
    name: "Scheduler",
    description: "Time-based workflow triggers",
    icon: "Calendar",
    category: "Triggers",
    color: "text-blue-500",
    node_type: "scheduler",
    size: { width: 200, height: 120 },
    handles: [
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "Alpaca Data",
    description: "Get market data from Alpaca Markets",
    icon: "Database",
    category: "Data",
    color: "text-green-500",
    node_type: "alpacaData",
    size: { width: 200, height: 120 },
    handles: [
      { type: "source", position: "right", id: "output" }
    ]
  },
  {
    name: "Alpaca Trade",
    description: "Execute trades through Alpaca Markets",
    icon: "ShoppingCart",
    category: "Trading",
    color: "text-red-500",
    node_type: "alpacaTrade",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" }
    ]
  },
  {
    name: "Indicator",
    description: "Custom technical indicator analysis",
    icon: "Target",
    category: "Indicators",
    color: "text-purple-500",
    node_type: "indicator",
    size: { width: 200, height: 120 },
    handles: [
      { type: "target", position: "left", id: "input" },
      { type: "source", position: "right", id: "output" }
    ]
  }
];

export type ManifestEntry = typeof nodeManifest[number];