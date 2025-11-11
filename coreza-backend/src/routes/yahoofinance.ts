import express from 'express';
import { DataService } from '../services/data';

const router = express.Router();

// Get quote data
router.get('/quote/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    
    const result = await DataService.execute('yahoofinance', 'get_quote', { symbol });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get historical data
router.get('/history/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { period1, period2, interval = '1d' } = req.query;
    
    const result = await DataService.execute('yahoofinance', 'get_history', {
      symbol,
      period1: period1 as string,
      period2: period2 as string,
      interval: interval as string
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Search symbols
router.get('/search/:query', async (req, res, next) => {
  try {
    const { query } = req.params;
    
    const result = await DataService.execute('yahoofinance', 'search', { query });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get market summary
router.get('/summary', async (req, res, next) => {
  try {
    const result = await DataService.execute('yahoofinance', 'get_summary', {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get trending symbols
router.get('/trending', async (req, res, next) => {
  try {
    const result = await DataService.execute('yahoofinance', 'get_trending', {});

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;