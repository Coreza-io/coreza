import express from 'express';
import { getScreenerService } from '../services/screeners/registry';

const router = express.Router();

// Generic screener endpoint - dynamic operation
router.post('/:screener/:operation', async (req, res) => {
  try {
    const { screener, operation } = req.params;
    const { user_id, credential_id, ...params } = req.body;

    console.log(`📊 [SCREENER-ROUTE] ${screener}/${operation} request:`, { user_id, credential_id, params });

    if (!user_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'user_id is required' 
      });
    }

    const screenerService = getScreenerService(screener);
    if (!screenerService) {
      return res.status(400).json({
        success: false,
        error: `Unsupported screener: ${screener}`
      });
    }

    const result = await screenerService.execute({
      user_id,
      credential_id,
      operation,
      ...params
    });

    console.log(`📊 [SCREENER-ROUTE] ${screener}/${operation} result:`, result);
    res.json(result);
  } catch (error: any) {
    console.error('[SCREENER-ROUTE] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

// Get user's screener credentials
router.get('/:screener/credentials', async (req, res) => {
  try {
    const { screener } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { BrokerService } = await import('../services/brokers');
    const credentials = await BrokerService.getCredentialsList(
      screener,
      user_id as string
    );

    res.json(credentials);
  } catch (error: any) {
    console.error('[SCREENER-ROUTE] Credentials error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
