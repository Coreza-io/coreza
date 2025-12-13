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

import GmailDef from './Gmail.json'
import AlpacaDef from './Alpaca.json'
import AlpacaTradeDef from './AlpacaTrade.json'
import AlpacaNewsDef from './AlpacaNews.json'
import AlpacaNewsRESTDef from './AlpacaNewsREST.json'
import AlpacaSubscribeDef from './AlpacaSubscribe.json'
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
import RSIToolDef from './RSITool.json'
import EMAToolDef from './EMATool.json'
import MACDToolDef from './MACDTool.json'
import BBToolDef from './BBTool.json'
import ADXToolDef from './ADXTool.json'
import StochToolDef from './StochTool.json'
import IchimokuToolDef from './IchimokuTool.json'
import OBVToolDef from './OBVTool.json'
import VWAPToolDef from './VWAPTool.json'
import VolumeOscillatorToolDef from './VolumeOscillatorTool.json'
import SupportResistanceToolDef from './SupportResistanceTool.json'
import YahooFinanceToolDef from './YahooFinanceTool.json'
import PolygonToolDef from './PolygonTool.json'
import MarketToolDef from './MarketTool.json'
import AlpacaMarketToolDef from './AlpacaMarketTool.json'
import BinanceMarketToolDef from './BinanceMarketTool.json'
import AlpacaTradeToolDef from './AlpacaTradeTool.json'
import BinanceTradeToolDef from './BinanceTradeTool.json'
import SchwabTradeToolDef from './SchwabTradeTool.json'
import DhanTradeToolDef from './DhanTradeTool.json'
import MathToolDef from './MathTool.json'
import TransformToolDef from './TransformTool.json'
import DateToolDef from './DateTool.json'
import HttpRequestToolDef from './HttpRequestTool.json'
import AlpacaScreenerDef from './AlpacaScreener.json'
import YahooFinanceScreenerDef from './YahooFinanceScreener.json'
import SchwabScreenerDef from './SchwabScreener.json'
import SupportResistanceDef from './SupportResistance.json'
import BinanceDef from './Binance.json'
import BinanceTradeDef from './BinanceTrade.json'
import BinanceScreenerDef from './BinanceScreener.json'
import BinanceSubscribeDef from './BinanceSubscribe.json'
import BinanceStreamDataDef from './BinanceStreamData.json'
import WhatsAppDef from './WhatsApp.json'
import RedisStoreDef from './RedisStore.json'
import RedisTriggerDef from './RedisTrigger.json'
import StoreDef from './Store.json'
import WebhookTriggerDef from './WebhookTrigger.json'
import TelegramTriggerDef from './TelegramTrigger.json'
import BacktestInitDef from './BacktestInit.json'
import BacktestTradeDef from './BacktestTrade.json'
import BacktestSnapshotDef from './BacktestSnapshot.json'
import BacktestResultsDef from './BacktestResults.json'
import BacktestPortfolioDef from './BacktestPortfolio.json'
import PolygonDef from './Polygon.json'
import InMemoryDef from './InMemory.json'

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
    required?: boolean;
  }[];
  authAction?: { url: string; method: string };  
  icon?: string;
  size?: { width: number; height: number };
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
  [AlpacaSubscribeDef.name]: AlpacaSubscribeDef,
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
  [RSIToolDef.name]: RSIToolDef,
  [EMAToolDef.name]: EMAToolDef,
  [MACDToolDef.name]: MACDToolDef,
  [BBToolDef.name]: BBToolDef,
  [ADXToolDef.name]: ADXToolDef,
  [StochToolDef.name]: StochToolDef,
  [IchimokuToolDef.name]: IchimokuToolDef,
  [OBVToolDef.name]: OBVToolDef,
  [VWAPToolDef.name]: VWAPToolDef,
  [VolumeOscillatorToolDef.name]: VolumeOscillatorToolDef,
  [SupportResistanceToolDef.name]: SupportResistanceToolDef,
  [YahooFinanceToolDef.name]: YahooFinanceToolDef,
  [PolygonToolDef.name]: PolygonToolDef,
  [MarketToolDef.name]: MarketToolDef,
  [AlpacaMarketToolDef.name]: AlpacaMarketToolDef,
  [BinanceMarketToolDef.name]: BinanceMarketToolDef,
  [AlpacaTradeToolDef.name]: AlpacaTradeToolDef,
  [BinanceTradeToolDef.name]: BinanceTradeToolDef,
  [SchwabTradeToolDef.name]: SchwabTradeToolDef,
  [DhanTradeToolDef.name]: DhanTradeToolDef,
  [MathToolDef.name]: MathToolDef,
  [TransformToolDef.name]: TransformToolDef,
  [DateToolDef.name]: DateToolDef,
  [HttpRequestToolDef.name]: HttpRequestToolDef,
  [AlpacaScreenerDef.name]: AlpacaScreenerDef,
  [YahooFinanceScreenerDef.name]: YahooFinanceScreenerDef,
  [SchwabScreenerDef.name]: SchwabScreenerDef,
  [SupportResistanceDef.name]: SupportResistanceDef,
  [BinanceDef.name]: BinanceDef,
  [BinanceTradeDef.name]: BinanceTradeDef,
  [BinanceScreenerDef.name]: BinanceScreenerDef,
  [BinanceSubscribeDef.name]: BinanceSubscribeDef,
  [BinanceStreamDataDef.name]: BinanceStreamDataDef,
  [WhatsAppDef.name]: WhatsAppDef,
  [RedisStoreDef.name]: RedisStoreDef,
  [RedisTriggerDef.name]: RedisTriggerDef,
  [StoreDef.name]: StoreDef,
  [WebhookTriggerDef.name]: WebhookTriggerDef,
  [TelegramTriggerDef.name]: TelegramTriggerDef,
  [BacktestInitDef.name]: BacktestInitDef,
  [BacktestTradeDef.name]: BacktestTradeDef,
  [BacktestSnapshotDef.name]: BacktestSnapshotDef,
  [BacktestResultsDef.name]: BacktestResultsDef,
  [BacktestPortfolioDef.name]: BacktestPortfolioDef,
  [PolygonDef.name]: PolygonDef,
  [InMemoryDef.name]: InMemoryDef
} as const;

export type ManifestEntry = typeof nodeManifest[keyof typeof nodeManifest];
