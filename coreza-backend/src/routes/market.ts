import express from 'express';
import { DataService } from '../services/data';

const router = express.Router();

// Get candle data from Yahoo Finance
router.post('/get-candle', async (req, res) => {
  try {
    const { ticker, interval = '1d', lookback = 100 } = req.body;

    if (!ticker) {
      return res.status(400).json({ error: 'Ticker symbol is required' });
    }

    const result = await DataService.execute('market', 'get_candle', {
      ticker,
      interval,
      lookback
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    console.error('Market data API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch market data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;