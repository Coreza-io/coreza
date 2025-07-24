import express from 'express';
import yahooFinance from 'yahoo-finance2';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// Get quote data
router.get('/quote/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    
    const quote = await yahooFinance.quote(symbol);
    
    res.json({
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
      marketCap: quote.marketCap,
      previousClose: quote.regularMarketPreviousClose,
      open: quote.regularMarketOpen,
      dayHigh: quote.regularMarketDayHigh,
      dayLow: quote.regularMarketDayLow,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(createError(`Failed to fetch quote for ${req.params.symbol}`, 400));
  }
});

// Get historical data
router.get('/history/:symbol', async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const { period1, period2, interval = '1d' } = req.query;
    
    const options: any = {
      period1: period1 ? new Date(period1 as string) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
      period2: period2 ? new Date(period2 as string) : new Date(),
      interval
    };
    
    const history = await yahooFinance.historical(symbol, options);
    
    res.json({
      symbol,
      interval,
      data: history.map(item => ({
        date: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        adjClose: item.adjClose
      }))
    });
  } catch (error) {
    next(createError(`Failed to fetch historical data for ${req.params.symbol}`, 400));
  }
});

// Search symbols
router.get('/search/:query', async (req, res, next) => {
  try {
    const { query } = req.params;
    
    const results = await yahooFinance.search(query);
    
    res.json({
      query,
      results: results.quotes?.map(quote => ({
        symbol: quote.symbol,
        shortname: quote.shortname,
        longname: quote.longname,
        exchange: quote.exchange,
        type: quote.quoteType
      })) || []
    });
  } catch (error) {
    next(createError(`Failed to search for ${req.params.query}`, 400));
  }
});

// Get market summary
router.get('/summary', async (req, res, next) => {
  try {
    const indices = ['^GSPC', '^DJI', '^IXIC', '^RUT']; // S&P 500, Dow, Nasdaq, Russell 2000
    const quotes = await Promise.all(
      indices.map(async (symbol) => {
        try {
          const quote = await yahooFinance.quote(symbol);
          return {
            symbol: quote.symbol,
            name: quote.shortName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent
          };
        } catch {
          return null;
        }
      })
    );
    
    res.json({
      timestamp: new Date().toISOString(),
      indices: quotes.filter(Boolean)
    });
  } catch (error) {
    next(createError('Failed to fetch market summary', 500));
  }
});

// Get trending symbols
router.get('/trending', async (req, res, next) => {
  try {
    const trending = await yahooFinance.trendingSymbols('US');
    
    res.json({
      region: 'US',
      trending: trending.quotes?.map(quote => ({
        symbol: quote.symbol,
        name: quote.shortName,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent
      })) || []
    });
  } catch (error) {
    next(createError('Failed to fetch trending symbols', 500));
  }
});

export default router;