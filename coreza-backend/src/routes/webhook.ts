import express from 'express';
import { webhookService } from '../services/WebhookService';
import { createLogger } from '../utils/logger';

const router = express.Router();
const logger = createLogger('webhook-routes');

/**
 * Register webhook - generates callback URL
 */
router.post('/register', async (req, res) => {
  try {
    const { user_id, workflow_id, node_id } = req.body;

    if (!user_id || !workflow_id || !node_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id, workflow_id, and node_id are required',
      });
    }

    const callbackUrl = webhookService.generateCallbackUrl(
      user_id,
      workflow_id,
      node_id
    );

    logger.info(
      { userId: user_id, workflowId: workflow_id, nodeId: node_id },
      'Webhook registered'
    );

    res.json({
      success: true,
      callback_url: callbackUrl,
      status: 'listening',
      message: 'Webhook endpoint is ready to receive events',
    });
  } catch (error) {
    logger.error({ err: error }, 'Error registering webhook');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Receive incoming webhook events (called by external services)
 */
router.all('/incoming/:userId/:workflowId/:nodeId', async (req, res) => {
  const { userId, workflowId, nodeId } = req.params;

  try {
    // Process webhook asynchronously
    // We return 200 immediately to prevent external service retries
    webhookService.handleIncoming({
      userId,
      workflowId,
      nodeId,
      method: req.method,
      headers: req.headers as Record<string, any>,
      body: req.body,
      query: req.query as Record<string, any>,
    });

    // Always return 200 OK to external services
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error({ err: error }, 'Error in webhook endpoint');
    // Still return 200 to prevent retries
    res.status(200).json({ received: true });
  }
});

/**
 * Get webhook status
 */
router.get('/status/:workflowId/:nodeId', async (req, res) => {
  try {
    const { workflowId, nodeId } = req.params;

    const status = await webhookService.getStatus(workflowId, nodeId);

    res.json(status);
  } catch (error) {
    logger.error({ err: error }, 'Error getting webhook status');
    res.status(500).json({
      active: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
