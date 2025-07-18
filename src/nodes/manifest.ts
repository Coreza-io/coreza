// JSON imports for node definitions
// Note: For now using placeholder objects until actual JSON files are created
const EmailDef = { name: "Email", def: "Email node definition", node_type: "email", icon: "Mail", category: "Communication", description: "Send email notifications with trading signals", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }], fields: [] };

// Complete Alpaca node definition based on provided JSON
const AlpacaDef = {
  name: "Alpaca",
  def: "Alpaca",
  node_type: "main",
  icon: "/assets/icons/alpaca.svg",
  category: "Trading",
  description: "Execute trades and get market data from Alpaca Markets",
  color: "text-green-600",
  size: { width: 340, height: 360 },
  handles: [
    { type: "target", position: "left", id: "input" },
    { type: "source", position: "right", id: "output" }
  ],
  auth: "GenericAuthModal",
  authFields: [
    {
      key: "credential_name",
      label: "Credential Label",
      type: "text",
      default: "My Alpaca"
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      placeholder: "Your Alpaca API Key"
    },
    {
      key: "secret_key",
      label: "Secret Key",
      type: "password",
      placeholder: "Your Alpaca Secret Key"
    }
  ],
  authAction: { url: "/alpaca/auth-url", method: "POST" },
  action: {
    url: "/alpaca/{{operation}}",
    method: "{{method}}"
  },
  fields: [
    {
      key: "credential_id",
      label: "Credential",
      type: "select",
      optionsSource: "credentialsApi",
      placeholder: "Select credential",
      required: true
    },
    {
      key: "operation",
      label: "Operation",
      type: "select",
      options: [
        { id: "get_account", name: "Get Account", method: "GET" },
        { id: "get_positions", name: "Get Positions", method: "GET" },
        { id: "get_orders", name: "Get Orders", method: "GET" },
        { id: "cancel_order", name: "Cancel Orders", method: "POST" },
        { id: "get_candle", name: "Get Historical Bars", method: "POST" }
      ],
      placeholder: "Select operation",
      required: true
    },
    {
      key: "symbol",
      label: "Ticker Symbol",
      type: "text",
      placeholder: "e.g. AAPL",
      required: true,
      displayOptions: {
        show: {
          operation: ["get_candle"]
        }
      }
    },
    {
      key: "interval",
      label: "Interval",
      type: "select",
      options: [
        { id: "1Min", name: "1 min" },
        { id: "5Min", name: "5 min" },
        { id: "15Min", name: "15 min" },
        { id: "1Hour", name: "1 hour" },
        { id: "1Day", name: "1 day" }
      ],
      placeholder: "Select interval",
      required: true,
      displayOptions: {
        show: {
          operation: ["get_candle"]
        }
      }
    },
    {
      key: "lookback",
      label: "Bars to Fetch",
      type: "text",
      placeholder: "e.g. 100",
      required: true,
      displayOptions: {
        show: {
          operation: ["get_candle"]
        }
      }
    }
  ]
};
const OpenAiDef = { name: "OpenAI", def: "OpenAI node definition", node_type: "openai", icon: "Brain", category: "AI", description: "AI-powered market analysis and predictions", color: "text-purple-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const AgentDef = { name: "Agent", def: "Agent node definition", node_type: "agent", icon: "Bot", category: "AI", description: "Intelligent trading agent", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const ChatInputDef = { name: "Chat Input", def: "Chat Input node definition", node_type: "chatInput", icon: "MessageSquare", category: "Input", description: "Interactive chat interface for trading commands", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const FinnHubDef = { name: "FinnHub", def: "FinnHub node definition", node_type: "finnhub", icon: "Database", category: "Data", description: "Real-time financial market data from FinnHub", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const YahooFinanceDef = { name: "Yahoo Finance", def: "Yahoo Finance node definition", node_type: "yahooFinance", icon: "TrendingUp", category: "Data", description: "Market data and historical prices from Yahoo Finance", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const MovingAverageCrossDef = { name: "Moving Average Cross", def: "Moving Average Cross node definition", node_type: "movingAverageCross", icon: "Activity", category: "Indicators", description: "Moving average crossover strategy indicator", color: "text-orange-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };
const EMADef = {
  "name": "EMA",
  "def": "Exponential Moving Average",
  "node_type": "main",
  "icon": "/assets/icons/ema.svg",
  "category": "Indicators",
  "description": "Exponential Moving Average indicator",
  "color": "text-blue-500",
  "size": { "width": 300, "height": 220 },
  "handles": [
    { "type": "target", "position": "left", "id": "input" },
    { "type": "source", "position": "right", "id": "output" }
  ],
  "action": {
    "url": "/indicators/ema",
    "method": "POST"
  },
  "fields": [
    {
      "key": "candle_data",
      "label": "Candle Data",
      "type": "text",
      "required": true
    },
    {
      "key": "window",
      "label": "EMA Window",
      "type": "text",
      "placeholder": "e.g. 20",
      "default": "20",
      "required": true
    }
  ]
};

const RSIDef = {
  "name": "RSI",
  "def": "Relative Strength Index technical indicator",
  "node_type": "main",
  "icon": "/assets/icons/rsi.svg",
  "category": "Indicators",
  "description": "Relative Strength Index indicator",
  "color": "text-blue-500",
  "size": { "width": 300, "height": 220 },
  "handles": [
    { "type": "target", "position": "left", "id": "input" },
    { "type": "source", "position": "right", "id": "output" }
  ],
  "action": {
    "url": "/indicators/rsi",
    "method": "POST"
  },
  "fields": [
    {
      "key": "candle_data",
      "label": "Candle Data",
      "type": "text",
      "required": true
    },
    {
      "key": "window",
      "label": "EMA Window",
      "type": "text",
      "placeholder": "e.g. 20",
      "default": "20",
      "required": true
    }
  ]
};
const VisualizeDef = { name: "Visualize", def: "Visualize node definition", node_type: "visualize", icon: "BarChart3", category: "Visualization", description: "Chart and visualize trading data", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }], fields: [] };
const IfDef = {
  name: "If",
  label: "If",
  def: "Evaluate one or more conditions and branch on true/false",
  node_type: "main",
  icon: "/assets/icons/if.svg",
  category: "Logic",
  description: "Conditional logic for trading decisions",
  color: "text-yellow-500",
  size: { width: 340, height: 340 },
  handles: [
    { type: "target", position: "left", id: "input" },
    { type: "source", position: "right", id: "true" },
    { type: "source", position: "right", id: "false" }
  ],
  action: {
    url: "/comparator/if",
    method: "POST"
  },
  fields: [
    {
      key: "conditions",
      label: "conditions",
      type: "repeater",
      subFields: [
        { key: "left", type: "string", placeholder: "{{ $json.value }}" },
        { 
          key: "operator", 
          type: "string", 
          options: [
            { label: "equals", value: "===" },
            { label: "not equals", value: "!==" },
            { label: "greater than", value: ">=" },
            { label: "less than", value: "<=" }
          ]
        },
        { key: "right", type: "string", placeholder: "100" }
      ],
      default: { left: "", operator: "===", right: "" }
    }
  ]
};
const SchedulerDef = { name: "Scheduler", def: "Scheduler node definition", node_type: "scheduler", icon: "Calendar", category: "Triggers", description: "Time-based workflow triggers", color: "text-blue-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const AlpacaDataDef = { name: "Alpaca Data", def: "Alpaca Data node definition", node_type: "alpacaData", icon: "Database", category: "Data", description: "Get market data from Alpaca Markets", color: "text-green-500", size: { width: 200, height: 120 }, handles: [{ type: "source", position: "right", id: "output" }], fields: [] };
const AlpacaTradeDef = {
  "name": "AlpacaTrade",
  "def": "Alpaca Trade",
  "node_type": "main",
  "icon": "/assets/icons/alpaca.svg",
  "category": "Trading",
  "description": "Execute trades through Alpaca Markets",
  "color": "text-red-500",
  "size": { "width": 340, "height": 360 },
  "parentNode":"Alpaca",
  "handles": [
    { "type": "target", "position": "left", "id": "input" },
    { "type": "source", "position": "right", "id": "output" }
  ],
  "auth": "GenericAuthModal",
  "authFields": [
    {
      "key": "credential_name",
      "label": "Credential Label",
      "type": "text",
      "default": "My Alpaca"
    },
    {
      "key": "api_key",
      "label": "API Key",
      "type": "password",
      "placeholder": "Your Alpaca API Key"
    },
    {
      "key": "secret_key",
      "label": "Secret Key",
      "type": "password",
      "placeholder": "Your Alpaca Secret Key"
    }
  ],
  "authAction": { "url": "/alpaca/auth-url", "method": "POST" },

  "action": { "url": "/alpaca/order", "method": "POST" },
  "fields": [
    {
      "key": "credential_id",
      "label": "Credential",
      "type": "select",
      "optionsSource": "credentialsApi",
      "placeholder": "Select credential",
      "required": true
    },
    {
      "key": "symbol",
      "label": "Ticker Symbol",
      "type": "text",
      "placeholder": "e.g. AAPL",
      "required": true
    },
    {
      "key": "side",
      "label": "Side",
      "type": "select",
      "options": [
        { "id": "buy", "name": "Buy" },
        { "id": "sell", "name": "Sell" }
      ],
      "default": "buy",
      "required": true
    },
    {
      "key": "qty",
      "label": "Quantity",
      "type": "text",
      "placeholder": "e.g. 1",
      "required": true
    },
    {
      "key": "type",
      "label": "Order Type",
      "type": "select",
      "options": [
        { "id": "market", "name": "Market" },
        { "id": "limit", "name": "Limit" }
      ],
      "default": "market",
      "required": true
    },
    {
      "key": "time_in_force",
      "label": "Time In Force",
      "type": "select",
      "options": [
        { "id": "day", "name": "Day" },
        { "id": "gtc", "name": "Good Till Cancelled" },
        { "id": "fok", "name": "Fill Or Kill" },
        { "id": "ioc", "name": "Immediate Or Cancel" }
      ],
      "default": "day",
      "required": true
    }
  ]
};
const SwitchDef = {
  name: "Switch",
  label: "Switch",
  def: "Route execution based on input value to multiple paths",
  node_type: "main",
  icon: "/assets/icons/switch.svg",
  category: "Logic",
  description: "Multi-path conditional routing for complex workflow logic",
  color: "text-orange-500",
  size: { width: 360, height: 300 },
  handles: [
    { type: "target", position: "left", id: "input" },
    { type: "source", position: "right", id: "case1" },
    { type: "source", position: "right", id: "case2" }
  ],
  action: {
    url: "/comparator/switch",
    method: "POST"
  },
  fields: [
    {
      key: "inputValue",
      label: "Input Value",
      type: "text",
      placeholder: "{{ $json.field }}",
      required: true
    },
    {
      key: "cases",
      label: "Cases",
      type: "repeater",
      subFields: [
        { key: "caseValue", type: "string", placeholder: "case1" },
        { key: "caseName", type: "string", placeholder: "Case Label" }
      ]
    },
    {
      key: "defaultCase",
      label: "Default Case",
      type: "text",
      placeholder: "default",
      default: "default",
      required: false
    }
  ]
};

const IndicatorDef = { name: "Indicator", def: "Indicator node definition", node_type: "indicator", icon: "Target", category: "Indicators", description: "Custom technical indicator analysis", color: "text-purple-500", size: { width: 200, height: 120 }, handles: [{ type: "target", position: "left", id: "input" }, { type: "source", position: "right", id: "output" }], fields: [] };

const MarketStatusDef = {
  name: "Market Status",
  def: "Market Status",
  node_type: "main",
  icon: "Building2",
  category: "Data",
  description: "Get real-time market status, hours, and trading sessions for global markets",
  color: "text-blue-500",
  size: { width: 320, height: 280 },
  handles: [
    { type: "source", position: "right", id: "output" }
  ],
  action: {
    url: "/market-status",
    method: "POST"
  },
  fields: [
    {
      key: "market_type",
      label: "Market Type",
      type: "select",
      options: [
        { id: "stocks", name: "Stocks" },
        { id: "crypto", name: "Crypto" },
        { id: "forex", name: "Forex" },
        { id: "commodities", name: "Commodities" },
        { id: "bonds", name: "Bonds" }
      ],
      placeholder: "Select market type",
      required: true
    },
    {
      key: "exchange",
      label: "Exchange",
      type: "select",
      options: [],
      placeholder: "Select exchange",
      required: true,
      dependsOn: "market_type",
      conditionalOptions: {
        stocks: [
          { id: "nyse", name: "NYSE" },
          { id: "nasdaq", name: "NASDAQ" },
          { id: "lse", name: "London Stock Exchange" },
          { id: "euronext", name: "Euronext" },
          { id: "tse", name: "Tokyo Stock Exchange" },
          { id: "hkex", name: "Hong Kong Exchange" },
          { id: "tsx", name: "Toronto Stock Exchange" }
        ],
        crypto: [
          { id: "binance", name: "Binance" },
          { id: "coinbase", name: "Coinbase" },
          { id: "kraken", name: "Kraken" },
          { id: "bitfinex", name: "Bitfinex" },
          { id: "gemini", name: "Gemini" },
          { id: "huobi", name: "Huobi" }
        ],
        forex: [
          { id: "london", name: "London Session" },
          { id: "new_york", name: "New York Session" },
          { id: "tokyo", name: "Tokyo Session" },
          { id: "sydney", name: "Sydney Session" }
        ],
        commodities: [
          { id: "comex", name: "COMEX" },
          { id: "nymex", name: "NYMEX" },
          { id: "lme", name: "London Metal Exchange" },
          { id: "cbot", name: "Chicago Board of Trade" }
        ],
        bonds: [
          { id: "us_treasury", name: "US Treasury" },
          { id: "uk_gilts", name: "UK Gilts" },
          { id: "german_bunds", name: "German Bunds" },
          { id: "japanese_bonds", name: "Japanese Government Bonds" }
        ]
      }
    },
    {
      key: "info_types",
      label: "Information Types",
      type: "multiselect",
      options: [
        { id: "status", name: "Market Status (Open/Closed)" },
        { id: "hours", name: "Trading Hours" },
        { id: "next_event", name: "Next Open/Close Event" },
        { id: "holidays", name: "Upcoming Holidays" },
        { id: "session_type", name: "Session Type (Regular/Extended)" }
      ],
      default: ["status", "hours"],
      required: true
    },
    {
      key: "timezone",
      label: "Timezone",
      type: "select",
      options: [
        { id: "UTC", name: "UTC" },
        { id: "America/New_York", name: "Eastern Time (ET)" },
        { id: "Europe/London", name: "London Time (GMT/BST)" },
        { id: "Asia/Tokyo", name: "Tokyo Time (JST)" },
        { id: "Asia/Hong_Kong", name: "Hong Kong Time (HKT)" }
      ],
      default: "America/New_York",
      required: true
    }
  ]
};

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
  [EmailDef.name]: EmailDef,
  [OpenAiDef.name]: OpenAiDef,
  [AgentDef.name]: AgentDef,
  [ChatInputDef.name]: ChatInputDef,
  [FinnHubDef.name]: FinnHubDef,
  [YahooFinanceDef.name]: YahooFinanceDef,
  [MovingAverageCrossDef.name]: MovingAverageCrossDef,
  [RSIDef.name]: RSIDef,
  [EMADef.name]: EMADef,
  [IfDef.name]: IfDef,
  [SwitchDef.name]: SwitchDef,
  [VisualizeDef.name]: VisualizeDef,
  [SchedulerDef.name]: SchedulerDef,
  [AlpacaDataDef.name]: AlpacaDataDef,
  [AlpacaTradeDef.name]: AlpacaTradeDef,
  [IndicatorDef.name]: IndicatorDef,
  [MarketStatusDef.name]: MarketStatusDef
} as const;

export type ManifestEntry = typeof nodeManifest[keyof typeof nodeManifest];
