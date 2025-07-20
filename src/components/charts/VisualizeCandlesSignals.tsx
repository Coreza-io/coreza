import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts';

interface CandleData {
  t: string[];  // timestamps
  o: number[];  // open
  h: number[];  // high 
  l: number[];  // low
  c: number[];  // close
  v: number[];
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
  const hasData = candles?.t?.length > 0;

  if (!hasData) {
    return (
      <div className="w-full h-48 bg-muted/20 rounded-lg border border-border flex items-center justify-center">
        <span className="text-muted-foreground text-sm">No chart data available</span>
      </div>
    );
  }

  // Prepare chart data by combining candles and indicators
  const chartData = candles.t.map((timestamp, index) => ({
    timestamp: timestamp?.slice(5, 10) || `${index}`, // Format as MM-DD
    close: candles.c[index],
    high: candles.h[index],
    low: candles.l[index],
    open: candles.o[index],
    indicator: indicator?.data[index]?.value || null,
  }));

  // Extract buy/sell signals from indicator data
  const buySignals = indicator?.data?.filter(d => d.signal === 'buy') || [];
  const sellSignals = indicator?.data?.filter(d => d.signal === 'sell') || [];

  return (
    <div className="w-full bg-gradient-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">
          Candlestick Chart ({candles.t.length} data points)
        </span>
        {indicator && (
          <span className="text-xs text-muted-foreground">
            Visualize: {indicator.data.length} indicators
          </span>
        )}
      </div>
      
      <div className="w-full h-64 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
              formatter={(value: any, name: string) => [
                typeof value === 'number' ? value.toFixed(4) : value,
                name === 'close' ? 'Close Price' : name === 'indicator' ? indicator?.name : name
              ]}
            />
            
            {/* Price line */}
            <Line 
              type="monotone" 
              dataKey="close" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              dot={false}
              name="Close Price"
            />
            
            {/* Indicator line */}
            {indicator && (
              <Line 
                type="monotone" 
                dataKey="indicator" 
                stroke={indicator.color}
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="2 2"
                name={indicator.name}
                connectNulls={false}
              />
            )}
            
            {/* Buy signals */}
            {buySignals.map((signal, index) => {
              const dataIndex = candles.t.findIndex(t => t === signal.timestamp);
              if (dataIndex >= 0 && chartData[dataIndex]) {
                return (
                  <ReferenceDot
                    key={`buy-${index}`}
                    x={chartData[dataIndex].timestamp}
                    y={chartData[dataIndex].close}
                    r={4}
                    fill="hsl(var(--success))"
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              }
              return null;
            })}
            
            {/* Sell signals */}
            {sellSignals.map((signal, index) => {
              const dataIndex = candles.t.findIndex(t => t === signal.timestamp);
              if (dataIndex >= 0 && chartData[dataIndex]) {
                return (
                  <ReferenceDot
                    key={`sell-${index}`}
                    x={chartData[dataIndex].timestamp}
                    y={chartData[dataIndex].close}
                    r={4}
                    fill="hsl(var(--destructive))"
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              }
              return null;
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-success"></div>
          <span className="text-muted-foreground">Buy Signals</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-destructive"></div>
          <span className="text-muted-foreground">Sell Signals</span>
        </div>
      </div>
    </div>
  );
};

export default VisualizeCandlesSignals;