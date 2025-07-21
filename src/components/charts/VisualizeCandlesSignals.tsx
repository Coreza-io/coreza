import React, { useState } from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceDot,
  ComposedChart,
  Bar,
  Cell
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BarChart3, 
  BarChart,
  LineChart as LineChartIcon,
  Activity
} from 'lucide-react';

interface CandleData {
  t: string[] | string;  // timestamps - can be array or single value
  o: number[] | number;  // open - can be array or single value
  h: number[] | number;  // high - can be array or single value 
  l: number[] | number;  // low - can be array or single value
  c: number[] | number;  // close - can be array or single value
  v: number[] | number;  // volume - can be array or single value
}

interface IndicatorData {
  name: string;
  color: string;
  data: Array<{ value: number; timestamp?: string; signal?: 'buy' | 'sell' }>;
}

interface VisualizeCandlesSignalsProps {
  candles: CandleData;
  indicator?: IndicatorData;
}

const VisualizeCandlesSignals: React.FC<VisualizeCandlesSignalsProps> = ({ candles, indicator }) => {
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  const [showVolume, setShowVolume] = useState(true);
  const [showIndicator, setShowIndicator] = useState(true);
  
  // Normalize data to arrays
  const normalizeToArray = (data: any[] | any): any[] => {
    return Array.isArray(data) ? data : [data];
  };

  const timestamps = normalizeToArray(candles.t);
  const opens = normalizeToArray(candles.o);
  const highs = normalizeToArray(candles.h);
  const lows = normalizeToArray(candles.l);
  const closes = normalizeToArray(candles.c);
  const volumes = normalizeToArray(candles.v);
  
  const hasData = timestamps.length > 0;

  if (!hasData) {
    return (
      <div className="w-full h-96 bg-card rounded-lg border border-border flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
          <span className="text-muted-foreground">No chart data available</span>
        </div>
      </div>
    );
  }

  // Prepare chart data by combining candles and indicators
  const chartData = timestamps.map((timestamp, index) => {
    const open = opens[index] || opens[0];
    const close = closes[index] || closes[0];
    const high = highs[index] || highs[0];
    const low = lows[index] || lows[0];
    const volume = volumes[index] || volumes[0] || 0;
    
    // Calculate candlestick body and shadows
    const bodyTop = Math.max(open, close);
    const bodyBottom = Math.min(open, close);
    const bodyHeight = bodyTop - bodyBottom;
    const upperShadow = high - bodyTop;
    const lowerShadow = bodyBottom - low;
    const isBullish = close >= open;
    
    return {
      timestamp: timestamp?.slice(5, 10) || `${index}`,
      close,
      high,
      low,
      open,
      volume,
      bodyTop,
      bodyBottom,
      bodyHeight,
      upperShadow,
      lowerShadow,
      isBullish,
      candleColor: isBullish ? '#22c55e' : '#ef4444',
      volumeColor: isBullish ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)',
      indicator: indicator?.data[index]?.value || null,
    };
  });

  // Extract buy/sell signals from indicator data
  const buySignals = indicator?.data?.filter(d => d.signal === 'buy') || [];
  const sellSignals = indicator?.data?.filter(d => d.signal === 'sell') || [];

  // Custom Candlestick Component for Recharts
  const CandlestickChart = () => (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis 
          dataKey="timestamp" 
          tick={{ fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis 
          tick={{ fontSize: 10 }}
          domain={['dataMin - 5', 'dataMax + 5']}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: 'hsl(var(--background))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '6px'
          }}
          formatter={(value: any, name: string) => {
            if (name === 'volume') return [value?.toLocaleString(), 'Volume'];
            if (name === 'indicator') return [value?.toFixed(4), indicator?.name];
            return [typeof value === 'number' ? value.toFixed(4) : value, name];
          }}
          labelFormatter={(label) => `Time: ${label}`}
        />
        
        {/* Volume bars (if enabled) */}
        {showVolume && (
          <Bar dataKey="volume" opacity={0.3}>
            {chartData.map((entry, index) => (
              <Cell key={`volume-${index}`} fill={entry.volumeColor} />
            ))}
          </Bar>
        )}
        
        {/* Price data based on chart type */}
        {chartType === 'line' ? (
          <Line 
            type="monotone" 
            dataKey="close" 
            stroke="#3b82f6" 
            strokeWidth={2}
            dot={false}
            name="Close Price"
          />
        ) : (
          <>
            {/* High-Low lines (wicks) */}
            <Line 
              type="monotone" 
              dataKey="high" 
              stroke="#64748b" 
              strokeWidth={1}
              dot={false}
              connectNulls={false}
              name="High"
            />
            <Line 
              type="monotone" 
              dataKey="low" 
              stroke="#64748b" 
              strokeWidth={1}
              dot={false}
              connectNulls={false}
              name="Low"
            />
            {/* Candlestick bodies approximated with bars */}
            <Bar dataKey="bodyHeight" stackId="candle">
              {chartData.map((entry, index) => (
                <Cell key={`candle-${index}`} fill={entry.candleColor} />
              ))}
            </Bar>
          </>
        )}
        
        {/* Indicator line */}
        {indicator && showIndicator && (
          <Line 
            type="monotone" 
            dataKey="indicator" 
            stroke={indicator.color || '#8b5cf6'}
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 4"
            name={indicator.name}
            connectNulls={false}
          />
        )}
        
        {/* Buy signals */}
        {buySignals.map((signal, index) => {
          const dataIndex = timestamps.findIndex(t => t === signal.timestamp);
          if (dataIndex >= 0 && chartData[dataIndex]) {
            return (
              <ReferenceDot
                key={`buy-${index}`}
                x={chartData[dataIndex].timestamp}
                y={chartData[dataIndex].close}
                r={4}
                fill="#22c55e"
                stroke="white"
                strokeWidth={2}
              />
            );
          }
          return null;
        })}
        
        {/* Sell signals */}
        {sellSignals.map((signal, index) => {
          const dataIndex = timestamps.findIndex(t => t === signal.timestamp);
          if (dataIndex >= 0 && chartData[dataIndex]) {
            return (
              <ReferenceDot
                key={`sell-${index}`}
                x={chartData[dataIndex].timestamp}
                y={chartData[dataIndex].close}
                r={4}
                fill="#ef4444"
                stroke="white"
                strokeWidth={2}
              />
            );
          }
          return null;
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );

  return (
    <div className="w-full bg-card rounded-lg border border-border overflow-hidden">
      {/* Chart Controls */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {timestamps.length} candle{timestamps.length !== 1 ? 's' : ''}
          </Badge>
          {indicator && (
            <Badge variant="secondary" className="text-xs">
              {indicator.name}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Chart Type Selector */}
          <div className="flex items-center gap-1">
            <Button
              variant={chartType === 'candlestick' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChartType('candlestick')}
              className="h-7 px-2"
            >
              <BarChart className="w-3 h-3" />
            </Button>
            <Button
              variant={chartType === 'line' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setChartType('line')}
              className="h-7 px-2"
            >
              <LineChartIcon className="w-3 h-3" />
            </Button>
          </div>

          {/* Toggle Controls */}
          <Button
            variant={showVolume ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setShowVolume(!showVolume)}
            className="h-7 px-2 text-xs"
          >
            <BarChart3 className="w-3 h-3 mr-1" />
            Vol
          </Button>
          
          {indicator && (
            <Button
              variant={showIndicator ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setShowIndicator(!showIndicator)}
              className="h-7 px-2 text-xs"
            >
              <Activity className="w-3 h-3 mr-1" />
              Ind
            </Button>
          )}
        </div>
      </div>

      {/* Chart Container */}
      <div className="w-full h-96">
        <CandlestickChart />
      </div>

      {/* Chart Legend */}
      <div className="flex items-center justify-between p-3 border-t border-border bg-muted/10">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-success"></div>
            <span className="text-muted-foreground">Bull/Buy</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive"></div>
            <span className="text-muted-foreground">Bear/Sell</span>
          </div>
          {indicator && (
            <div className="flex items-center gap-1">
              <div 
                className="w-2 h-2 rounded-full" 
                style={{ backgroundColor: indicator.color }}
              ></div>
              <span className="text-muted-foreground">{indicator.name}</span>
            </div>
          )}
        </div>
        
        <div className="text-xs text-muted-foreground">
          {chartType.charAt(0).toUpperCase() + chartType.slice(1)} Chart
        </div>
      </div>
    </div>
  );
};

export default VisualizeCandlesSignals;