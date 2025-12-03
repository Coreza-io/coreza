import GmailDef from './Gmail.json'
import AlpacaDef from './Alpaca.json'
import AlpacaTradeDef from './AlpacaTrade.json'
import AlpacaNewsDef from './AlpacaNews.json'
import AlpacaNewsRESTDef from './AlpacaNewsREST.json'
import AlpacaStreamDataDef from './AlpacaStreamData.json'
import DhanDef from './Dhan.json'
import DhanTradeDef from './DhanTrade.json'
import SchwabTradeDef from './SchwabTrade.json'
import SchwabDef from './Schwab.json'
import IfDef from './If.json'
import SwitchDef from './Switch.json'
import EMADef from './EMA.json'
import RSIDef from './RSI.json'
import MarketDef from './Market.json'
import YahooFinanceDef from './YahooFinance.json'
import ChatInputDef from './ChatInput.json'
import DateDef from './Date.json'
import SchedulerDef from './Scheduler.json'
import VisualizeDef from './Visualize.json'
import MACDDef from './MACD.json'
import ADXDef from './ADX.json'
import StochDef from './Stoch.json'
import BBDDef from './BB.json'
import IchimokuDef from './Ichimoku.json'
import OBVDef from './OBV.json'
import VWAPDef from './VWAP.json'
import VolumeOscillatorDef from './VolumeOscillator.json'
import HttpRequestDef from './HttpRequest.json'
import RiskEngineDef from './RiskEngine.json'
import FieldDef from './Field.json'
import MathDef from './Math.json'
import TransformDef from './Transform.json'
import LoopDef from './Loop.json'
import OpenAIDef from './OpenAI.json'
import OpenAIChatModelDef from './OpenAIChatModel.json'
import AIAgentDef from './AIAgent.json'
import GoogleWebSearchDef from './GoogleWebSearch.json'
import AlpacaScreenerDef from './AlpacaScreener.json'
import YahooFinanceScreenerDef from './YahooFinanceScreener.json'
import SchwabScreenerDef from './SchwabScreener.json'
import SupportResistanceDef from './SupportResistance.json'
import BinanceDef from './Binance.json'
import BinanceTradeDef from './BinanceTrade.json'
import BinanceScreenerDef from './BinanceScreener.json'
import BinanceStreamDataDef from './BinanceStreamData.json'
import WhatsAppDef from './WhatsApp.json'
import RedisStoreDef from './RedisStore.json'
import RedisTriggerDef from './RedisTrigger.json'
import StoreDef from './Store.json'
import WebhookTriggerDef from './WebhookTrigger.json'
import TelegramTriggerDef from './TelegramTrigger.json'

// ============= NEW SCHEMA INTERFACES =============

/** Node execution role */
export type NodeRole = 'trigger' | 'action' | 'condition' | 'store' | 'util';

/** Node execution mode */
export type NodeExecution = 'stream' | 'polling' | 'http' | 'manual' | 'webhook';

/** Node tier classification */
export type NodeTier = 'main' | 'sub' | 'helper';

/** Provider type classification */
export type ProviderType = 'broker' | 'exchange' | 'api' | 'system' | 'internal';

/** Node domain/category for grouping */
export type NodeDomain = 
  | 'market_data'    // Streaming market data
  | 'trading'        // Order execution, account management
  | 'scanner'        // Stock/crypto screeners
  | 'indicators'     // Technical indicators (RSI, EMA, etc.)
  | 'logic'          // Conditionals, loops, transforms
  | 'data_source'    // REST data fetching (Yahoo, FinnHub)
  | 'storage'        // Redis, in-memory stores
  | 'scheduler'      // Cron/scheduled triggers
  | 'webhook'        // Webhook/API triggers
  | 'input'          // User input nodes
  | 'ai'             // LLM, AI agents
  | 'tool'           // HTTP requests, web search
  | 'visualization'  // Charts, visualizations
  | 'communication'  // Email, WhatsApp, Telegram
  | 'risk';          // Risk management

/** Provider metadata */
export interface NodeProvider {
  type: ProviderType;
  name: string; // alpaca, binance, dhan, schwab, openai, etc.
}

/** Node metadata - semantic classification */
export interface NodeMeta {
  role: NodeRole;
  execution: NodeExecution;
  tier: NodeTier;
  domain: NodeDomain;
  provider?: NodeProvider;
}

/** Node UI configuration */
export interface NodeUI {
  icon?: string;
  color?: string;
  size?: { width: number; height: number };
  description?: string;
}

/** Streaming node configuration */
export interface NodeStreaming {
  sourceId?: string;           // WebSocket config key (alpaca_stream, binance_stream)
  waitForFirstEvent?: boolean;
  timeout?: number;
}

/** Handle configuration */
export interface HandleConfig {
  type: string;
  position: string;
  id: string;
}

/** Auth field configuration */
export interface AuthFieldConfig {
  key: string;
  label: string;
  type: string;
  value?: string;
  default?: string;
  placeholder?: string;
  required?: boolean;
}

/** Action configuration */
export interface ActionConfig {
  url: string;
  method: string;
}

/** Field option configuration */
export interface FieldOption {
  id?: string;
  name?: string;
  method?: string;
  label?: string;
  value?: string;
}

/** SubField configuration */
export interface SubFieldConfig {
  key: string;
  type: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
  default?: any;
}

/** Field configuration */
export interface FieldConfig {
  key: string;
  label: string;
  type: string;
  subFields?: SubFieldConfig[];
  options?: FieldOption[];
  optionsSource?: string;
  dependsOn?: string;
  required?: boolean;
  placeholder?: string;
  default?: any;
  description?: string;
  displayOptions?: {
    show?: { [key: string]: string[] };
  };
}

// ============= NODE CONFIG INTERFACE =============

export interface NodeConfig {
  // NEW: Unique identifier (snake_case)
  id?: string;
  
  // KEEP: PascalCase name for manifest lookup
  name: string;
  
  // NEW: Human-readable label (replaces def)
  label?: string;
  
  // LEGACY: Keep for backward compat (use label instead)
  def?: string;
  
  // NEW: Semantic metadata object
  meta?: NodeMeta;
  
  // LEGACY: Keep for backward compat (use meta.tier instead)
  node_type?: string;
  
  // LEGACY: Keep for backward compat (use meta.domain instead)
  category?: string;
  
  // LEGACY: Keep for backward compat (use meta.provider.name instead)
  subCategory?: string;
  
  // NEW: UI configuration object
  ui?: NodeUI;
  
  // LEGACY: Keep for backward compat (use ui.* instead)
  icon?: string;
  color?: string;
  size?: { width: number; height: number };
  description?: string;
  
  // NEW: Streaming configuration object
  streaming?: NodeStreaming;
  
  // LEGACY: Keep for backward compat (use streaming.* instead)
  executionMode?: string;
  streamingConfig?: {
    waitForFirstEvent?: boolean;
    timeout?: number;
  };
  
  // Connection handles
  handles: HandleConfig[];
  
  // Authentication configuration
  auth?: string;
  authFields?: AuthFieldConfig[];
  authAction?: ActionConfig;
  
  // Action configuration
  action?: ActionConfig;
  
  // Field definitions
  fields: FieldConfig[];
  
  // Misc legacy fields
  parentNode?: string;
}

// ============= HELPER FUNCTIONS (Backward Compatibility) =============

/** Get node label with backward compat */
export const getNodeLabel = (def: NodeConfig): string => 
  def.label || def.def || def.name;

/** Get node domain with backward compat */
export const getNodeDomain = (def: NodeConfig): string => 
  def.meta?.domain || def.category || 'unknown';

/** Get node tier with backward compat */
export const getNodeTier = (def: NodeConfig): string => 
  def.meta?.tier || def.node_type || 'main';

/** Get node role with backward compat */
export const getNodeRole = (def: NodeConfig): string => 
  def.meta?.role || (def.node_type === 'trigger' ? 'trigger' : 'action');

/** Get node execution mode with backward compat */
export const getNodeExecution = (def: NodeConfig): string => 
  def.meta?.execution || def.executionMode || 'http';

/** Get node icon with backward compat */
export const getNodeIcon = (def: NodeConfig): string | undefined => 
  def.ui?.icon || def.icon;

/** Get node color with backward compat */
export const getNodeColor = (def: NodeConfig): string | undefined => 
  def.ui?.color || def.color;

/** Get node size with backward compat */
export const getNodeSize = (def: NodeConfig): { width: number; height: number } | undefined => 
  def.ui?.size || def.size;

/** Get node description with backward compat */
export const getNodeDescription = (def: NodeConfig): string | undefined => 
  def.ui?.description || def.description;

/** Get provider name with backward compat */
export const getProviderName = (def: NodeConfig): string | undefined => 
  def.meta?.provider?.name || def.subCategory?.toLowerCase() || undefined;

/** Get streaming config with backward compat */
export const getStreamingConfig = (def: NodeConfig): NodeStreaming | undefined => {
  if (def.streaming) return def.streaming;
  if (def.streamingConfig) {
    return {
      waitForFirstEvent: def.streamingConfig.waitForFirstEvent,
      timeout: def.streamingConfig.timeout,
    };
  }
  return undefined;
};

/** Get streaming source ID with backward compat */
export const getStreamingSourceId = (def: NodeConfig): string | undefined => 
  def.streaming?.sourceId;

/** Check if node is streaming type */
export const isStreamingNode = (def: NodeConfig): boolean => 
  def.meta?.execution === 'stream' || def.executionMode === 'streaming';

/** Check if node is trigger type */
export const isTriggerNode = (def: NodeConfig): boolean => 
  def.meta?.role === 'trigger' || def.node_type === 'trigger';

// ============= NODE MANIFEST =============

export const nodeManifest = {
  [AlpacaDef.name]: AlpacaDef,
  [DhanDef.name]: DhanDef,
  [GmailDef.name]: GmailDef,
  [ChatInputDef.name]: ChatInputDef,
  [DateDef.name]: DateDef,
  [YahooFinanceDef.name]: YahooFinanceDef,
  [RSIDef.name]: RSIDef,
  [EMADef.name]: EMADef,
  [MACDDef.name]: MACDDef,
  [ADXDef.name]: ADXDef,
  [StochDef.name]: StochDef,
  [BBDDef.name]: BBDDef,
  [IchimokuDef.name]: IchimokuDef,
  [OBVDef.name]: OBVDef,
  [VWAPDef.name]: VWAPDef,
  [VolumeOscillatorDef.name]: VolumeOscillatorDef,
  [IfDef.name]: IfDef,
  [SwitchDef.name]: SwitchDef,
  [VisualizeDef.name]: VisualizeDef,
  [SchedulerDef.name]: SchedulerDef,
  [AlpacaTradeDef.name]: AlpacaTradeDef,
  [AlpacaNewsDef.name]: AlpacaNewsDef,
  [AlpacaNewsRESTDef.name]: AlpacaNewsRESTDef,
  [AlpacaStreamDataDef.name]: AlpacaStreamDataDef,
  [DhanTradeDef.name]: DhanTradeDef,
  [SchwabTradeDef.name]: SchwabTradeDef,
  [SchwabDef.name]: SchwabDef,
  [MarketDef.name]: MarketDef,
  [HttpRequestDef.name]: HttpRequestDef,
  [RiskEngineDef.name]: RiskEngineDef,
  [FieldDef.name]: FieldDef,
  [MathDef.name]: MathDef,
  [TransformDef.name]: TransformDef,
  [LoopDef.name]: LoopDef,
  [OpenAIDef.name]: OpenAIDef,
  [OpenAIChatModelDef.name]: OpenAIChatModelDef,
  [AIAgentDef.name]: AIAgentDef,
  [GoogleWebSearchDef.name]: GoogleWebSearchDef,
  [AlpacaScreenerDef.name]: AlpacaScreenerDef,
  [YahooFinanceScreenerDef.name]: YahooFinanceScreenerDef,
  [SchwabScreenerDef.name]: SchwabScreenerDef,
  [SupportResistanceDef.name]: SupportResistanceDef,
  [BinanceDef.name]: BinanceDef,
  [BinanceTradeDef.name]: BinanceTradeDef,
  [BinanceScreenerDef.name]: BinanceScreenerDef,
  [BinanceStreamDataDef.name]: BinanceStreamDataDef,
  [WhatsAppDef.name]: WhatsAppDef,
  [RedisStoreDef.name]: RedisStoreDef,
  [RedisTriggerDef.name]: RedisTriggerDef,
  [StoreDef.name]: StoreDef,
  [WebhookTriggerDef.name]: WebhookTriggerDef,
  [TelegramTriggerDef.name]: TelegramTriggerDef
} as const;

export type ManifestEntry = typeof nodeManifest[keyof typeof nodeManifest];
