import express from 'express';
import { WebhookService } from '../services/webhooks';

const router = express.Router();

// Register a new webhook
router.post('/register', async (req, res, next) => {
  try {
    const { user_id, name, url, secret, events, headers, retry_attempts = 3, timeout = 10000 } = req.body;
    
    const result = await WebhookService.execute('register', {
      user_id,
      name,
      url,
      secret,
      events,
      headers,
      retry_attempts,
      timeout
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Update webhook configuration
router.put('/:webhookId', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, url, secret, events, headers, active, retry_attempts, timeout } = req.body;
    
    const result = await WebhookService.execute('update', {
      webhook_id: webhookId,
      user_id,
      url,
      secret,
      events,
      headers,
      active,
      retry_attempts,
      timeout
    });

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Delete webhook
router.delete('/:webhookId', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id } = req.body;
    
    const result = await WebhookService.execute('delete', {
      webhook_id: webhookId,
      user_id
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get user webhooks
router.get('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const result = await WebhookService.execute('list', { user_id: userId });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Test webhook
router.post('/:webhookId/test', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, test_data } = req.body;
    
    const result = await WebhookService.execute('test', {
      webhook_id: webhookId,
      user_id,
      data: test_data
    });

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get webhook delivery logs
router.get('/:webhookId/deliveries', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, limit = 50 } = req.query;
    
    const result = await WebhookService.execute('get_deliveries', {
      webhook_id: webhookId,
      user_id: user_id as string,
      limit: parseInt(limit as string)
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;