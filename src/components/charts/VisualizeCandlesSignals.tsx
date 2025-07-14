import React from 'react';

interface CandleData {
  t: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

interface IndicatorData {
  name: string;
  color: string;
  data: Array<{ value: number; timestamp?: string }>;
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

  return (
    <div className="w-full h-48 bg-gradient-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">
          Candlestick Chart ({candles.t.length} data points)
        </span>
        {indicator && (
          <span className="text-xs text-muted-foreground">
            {indicator.name}: {indicator.data.length} indicators
          </span>
        )}
      </div>
      <div className="w-full h-32 bg-trading-grid rounded flex items-center justify-center border border-border/50">
        <span className="text-muted-foreground text-xs">
          Chart visualization will be rendered here
        </span>
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