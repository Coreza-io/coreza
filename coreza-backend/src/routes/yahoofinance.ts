import express from 'express';
import yahooFinance from 'yahoo-finance2';

const router = express.Router();

// Get candle data from Yahoo Finance
router.post('/get-candle', async (req, res) => {
  try {
    const { ticker, interval = '1d', lookback = 100 } = req.body;

    if (!ticker) {
      return res.status(400).json({ error: 'Ticker symbol is required' });
    }

    // Calculate the start date based on lookback
    const endDate = new Date();
    const startDate = new Date();
    
    // Calculate days to go back based on interval and lookback
    let daysBack = parseInt(lookback);
    if (interval === '1m' || interval === '5m' || interval === '15m' || interval === '60m') {
      daysBack = Math.max(7, Math.ceil(daysBack / (6.5 * 60))); // Trading hours approximation
    }
    
    startDate.setDate(endDate.getDate() - daysBack);

    const queryOptions = {
      period1: startDate,
      period2: endDate,
      interval: interval as any
    };

    const result = await yahooFinance.historical(ticker, queryOptions);
    
    if (!result || result.length === 0) {
      return res.status(404).json({ error: 'No data found for the given ticker' });
    }

    // Transform data to match expected format
    const candleData = result.slice(-parseInt(lookback)).map(item => ({
      timestamp: item.date.getTime(),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume
    }));

    res.json({
      ticker,
      interval,
      data: candleData,
      count: candleData.length
    });

  } catch (error) {
    console.error('Yahoo Finance API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch data from Yahoo Finance',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;