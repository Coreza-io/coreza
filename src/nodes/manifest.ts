import GmailDef from './Gmail.json'
import AlpacaDef from './Alpaca.json'
import AlpacaTradeDef from './AlpacaTrade.json'
import DhanDef from './Dhan.json'
import DhanTradeDef from './DhanTrade.json'
import IfDef from './If.json'
import SwitchDef from './Switch.json'
import EMADef from './EMA.json'
import RSIDef from './RSI.json'
import MarketDef from './Market.json'
import YahooFinanceDef from './YahooFinance.json'
import ChatInputDef from './ChatInput.json'
import SchedulerDef from './Scheduler.json'
import VisualizeDef from './Visualize.json'
import MACDDef from './MACD.json'
import ADXDef from './ADX.json'
import StochDef from './Stoch.json'
import BBDDef from './BB.json'
import IchimokuDef from './Ichimoku.json'
import OBVDef from './OBV.json'
import VWAPDef from './VWAP.json'
import HttpRequestDef from './HttpRequest.json'
import RiskEngineDef from './RiskEngine.json'
import FieldDef from './Field.json'
import MathDef from './Math.json'
import TransformDef from './Transform.json'

// Node configuration interface
export interface NodeConfig {
  name: string;
  def: string;
  node_type: string;
  category?: string;
  description?: string;
  color?: string;
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
    options?: {
      id?: string;
      name?: string;
      method?: string;
      label?: string;
      value?: string;
    }[];
    optionsSource?: string;
    required?: boolean;
    placeholder?: string;
    default?: any;
    displayOptions?: {
      show?: {
        [key: string]: string[];
      };
    };
  }[];
}

export const nodeManifest = {
  [AlpacaDef.name]: AlpacaDef,
  [DhanDef.name]: DhanDef,
  [GmailDef.name]: GmailDef,
  [ChatInputDef.name]: ChatInputDef,
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
  [IfDef.name]: IfDef,
  [SwitchDef.name]: SwitchDef,
  [VisualizeDef.name]: VisualizeDef,
  [SchedulerDef.name]: SchedulerDef,
  [AlpacaTradeDef.name]: AlpacaTradeDef,
  [DhanTradeDef.name]: DhanTradeDef,
  [MarketDef.name]: MarketDef,
  [HttpRequestDef.name]: HttpRequestDef,
  [RiskEngineDef.name]: RiskEngineDef,
  [FieldDef.name]: FieldDef,
  [MathDef.name]: MathDef,
  [TransformDef.name]: TransformDef
} as const;

export type ManifestEntry = typeof nodeManifest[keyof typeof nodeManifest];
