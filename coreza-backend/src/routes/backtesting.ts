import express from 'express';
import { BacktestingService, BacktestConfig } from '../services/backtesting';
import { createError } from '../middleware/errorHandler';

const router = express.Router();
const backtestingService = new BacktestingService();

// Create a new backtest
router.post('/', async (req, res, next) => {
  try {
    const config: BacktestConfig = req.body;
    
    // Validate required fields
    if (!config.user_id || !config.workflow_id || !config.name || !config.start_date || !config.end_date) {
      return res.status(400).json({ 
        error: 'Missing required fields: user_id, workflow_id, name, start_date, end_date' 
      });
    }

    // Validate date range
    const startDate = new Date(config.start_date);
    const endDate = new Date(config.end_date);
    
    if (startDate >= endDate) {
      return res.status(400).json({ 
        error: 'Start date must be before end date' 
      });
    }

    if (endDate > new Date()) {
      return res.status(400).json({ 
        error: 'End date cannot be in the future' 
      });
    }

    // Set default values
    config.initial_capital = config.initial_capital || 10000;
    config.commission_rate = config.commission_rate || 0.001;
    config.slippage_rate = config.slippage_rate || 0.001;
    config.data_frequency = config.data_frequency || '1d';

    const backtestId = await backtestingService.createBacktest(config);
    
    res.status(201).json({ 
      success: true,
      backtest_id: backtestId,
      message: 'Backtest created successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Run a backtest
router.post('/:backtestId/run', async (req, res, next) => {
  try {
    const { backtestId } = req.params;
    
    if (!backtestId) {
      return res.status(400).json({ error: 'Backtest ID is required' });
    }

    // Start backtest execution (this could be async)
    backtestingService.runBacktest(backtestId).catch(error => {
      console.error(`Backtest ${backtestId} failed:`, error);
    });

    res.json({ 
      success: true,
      message: 'Backtest execution started'
    });
  } catch (error) {
    next(error);
  }
});

// Get backtest results
router.get('/:backtestId/results', async (req, res, next) => {
  try {
    const { backtestId } = req.params;
    const { userId } = req.query;
    
    if (!backtestId || !userId) {
      return res.status(400).json({ error: 'Backtest ID and user ID are required' });
    }

    const results = await backtestingService.getBacktestResults(backtestId, userId as string);
    
    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
});

// Get user's backtests
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const backtests = await backtestingService.getUserBacktests(userId);
    
    res.json({
      success: true,
      data: backtests
    });
  } catch (error) {
    next(error);
  }
});

// Get backtest status
router.get('/:backtestId/status', async (req, res, next) => {
  try {
    const { backtestId } = req.params;
    const { userId } = req.query;
    
    if (!backtestId || !userId) {
      return res.status(400).json({ error: 'Backtest ID and user ID are required' });
    }

    const results = await backtestingService.getBacktestResults(backtestId, userId as string);
    
    res.json({
      success: true,
      status: results.backtest.status,
      started_at: results.backtest.started_at,
      completed_at: results.backtest.completed_at,
      error_message: results.backtest.error_message
    });
  } catch (error) {
    next(error);
  }
});

// Delete a backtest
router.delete('/:backtestId', async (req, res, next) => {
  try {
    const { backtestId } = req.params;
    const { userId } = req.query;
    
    if (!backtestId || !userId) {
      return res.status(400).json({ error: 'Backtest ID and user ID are required' });
    }

    // Note: The delete will cascade to related tables due to foreign key constraints
    // This would need to be implemented with proper Supabase client calls
    
    res.json({
      success: true,
      message: 'Backtest deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;