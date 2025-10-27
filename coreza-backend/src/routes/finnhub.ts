import express from 'express';
import { DataService } from '../services/data';

const router = express.Router();

// Get user credentials list for FinnHub
router.get('/credentials', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const result = await DataService.execute('finnhub', 'list_credentials', { userId: user_id as string });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    res.json({
      success: true,
      credentials: result.data || []
    });
  } catch (error) {
    next(error);
  }
});

// Save and validate credentials (authAction)
router.post('/auth-url', async (req, res, next) => {
  try {
    const { user_id, credential_name, api_key } = req.body;
    
    if (!user_id || !credential_name || !api_key) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await DataService.execute('finnhub', 'save_credentials', {
      userId: user_id,
      credentialName: credential_name,
      apiKey: api_key
    });

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get quote data (main action)
router.post('/get-quote', async (req, res, next) => {
  try {
    const { user_id, credential_id, ticker } = req.body;
    
    if (!user_id || !credential_id || !ticker) {
      return res.status(400).json({ error: 'user_id, credential_id, and ticker are required' });
    }

    const result = await DataService.execute('finnhub', 'get_quote', {
      userId: user_id,
      credentialId: credential_id,
      ticker
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;