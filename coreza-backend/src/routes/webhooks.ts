import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';
import { QueueManager } from '../services/queueManager';
import { WebSocketManager } from '../services/websocketManager';

const router = express.Router();

interface WebhookConfig {
  id: string;
  userId: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  headers?: Record<string, string>;
  retryAttempts: number;
  timeout: number;
}

// Register a new webhook
router.post('/register', async (req, res, next) => {
  try {
    const { user_id, name, url, secret, events, headers, retry_attempts = 3, timeout = 10000 } = req.body;
    
    if (!user_id || !name || !url || !events || !Array.isArray(events)) {
      throw createError('user_id, name, url, and events array are required', 400);
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      throw createError('Invalid webhook URL', 400);
    }

    // Test webhook endpoint
    try {
      const testPayload = {
        event: 'webhook.test',
        timestamp: new Date().toISOString(),
        data: { message: 'Webhook registration test' }
      };

      await sendWebhookRequest(url, testPayload, secret, headers, timeout);
    } catch (error) {
      throw createError(`Webhook test failed: ${error.message}`, 400);
    }

    // Save webhook configuration
    const { data, error } = await supabase
      .from('webhooks')
      .insert({
        user_id,
        name,
        url,
        secret,
        events,
        headers: headers || {},
        retry_attempts,
        timeout,
        active: true
      })
      .select()
      .single();

    if (error) {
      throw createError('Failed to register webhook', 500);
    }

    res.json({
      success: true,
      webhook: data,
      message: 'Webhook registered successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Update webhook configuration
router.put('/:webhookId', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, url, secret, events, headers, active, retry_attempts, timeout } = req.body;
    
    if (!user_id) {
      throw createError('user_id is required', 400);
    }

    const updateData: any = {};
    if (url) updateData.url = url;
    if (secret !== undefined) updateData.secret = secret;
    if (events) updateData.events = events;
    if (headers) updateData.headers = headers;
    if (active !== undefined) updateData.active = active;
    if (retry_attempts) updateData.retry_attempts = retry_attempts;
    if (timeout) updateData.timeout = timeout;

    const { data, error } = await supabase
      .from('webhooks')
      .update(updateData)
      .eq('id', webhookId)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error || !data) {
      throw createError('Webhook not found or update failed', 404);
    }

    res.json({
      success: true,
      webhook: data,
      message: 'Webhook updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Delete webhook
router.delete('/:webhookId', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id } = req.body;
    
    if (!user_id) {
      throw createError('user_id is required', 400);
    }

    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', webhookId)
      .eq('user_id', user_id);

    if (error) {
      throw createError('Failed to delete webhook', 500);
    }

    res.json({
      success: true,
      message: 'Webhook deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get user webhooks
router.get('/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw createError('Failed to fetch webhooks', 500);
    }

    res.json({
      webhooks: data
    });
  } catch (error) {
    next(error);
  }
});

// Test webhook
router.post('/:webhookId/test', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, test_data } = req.body;
    
    if (!user_id) {
      throw createError('user_id is required', 400);
    }

    // Get webhook configuration
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', webhookId)
      .eq('user_id', user_id)
      .single();

    if (error || !webhook) {
      throw createError('Webhook not found', 404);
    }

    // Send test payload
    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: test_data || { message: 'Manual webhook test' }
    };

    const result = await sendWebhookRequest(
      webhook.url,
      testPayload,
      webhook.secret,
      webhook.headers,
      webhook.timeout
    );

    res.json({
      success: true,
      result,
      message: 'Webhook test completed successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Trigger webhook for specific events
export async function triggerWebhook(userId: string, event: string, data: any): Promise<void> {
  try {
    // Get active webhooks for user that listen to this event
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true);

    if (error) {
      console.error('Failed to fetch webhooks:', error);
      return;
    }

    const relevantWebhooks = webhooks.filter(webhook => 
      webhook.events.includes(event) || webhook.events.includes('*')
    );

    if (relevantWebhooks.length === 0) {
      return;
    }

    console.log(`🔗 Triggering ${relevantWebhooks.length} webhooks for event: ${event}`);

    // Send webhooks
    const promises = relevantWebhooks.map(webhook => 
      QueueManager.addNotification({
        userId,
        type: 'webhook',
        data: {
          webhook,
          event,
          payload: data
        }
      })
    );

    await Promise.all(promises);
  } catch (error) {
    console.error('Error triggering webhooks:', error);
  }
}

// Process webhook notification (called by queue worker)
export async function processWebhookNotification(data: any): Promise<void> {
  const { webhook, event, payload } = data;
  
  const webhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
    webhook_id: webhook.id
  };

  let attempts = 0;
  let success = false;
  let lastError: any;

  while (attempts < webhook.retry_attempts && !success) {
    try {
      attempts++;
      console.log(`🔗 Sending webhook ${webhook.id} (attempt ${attempts}/${webhook.retry_attempts})`);

      const result = await sendWebhookRequest(
        webhook.url,
        webhookPayload,
        webhook.secret,
        webhook.headers,
        webhook.timeout
      );

      success = true;
      
      // Log successful delivery
      await logWebhookDelivery(webhook.id, webhookPayload, true, result.status, null, attempts);
      
      console.log(`✅ Webhook ${webhook.id} delivered successfully`);
    } catch (error) {
      lastError = error;
      console.error(`❌ Webhook ${webhook.id} attempt ${attempts} failed:`, error.message);
      
      if (attempts < webhook.retry_attempts) {
        // Wait before retry (exponential backoff)
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  if (!success) {
    // Log failed delivery
    await logWebhookDelivery(webhook.id, webhookPayload, false, 0, lastError.message, attempts);
    
    // Notify user about webhook failure
    WebSocketManager.sendToUser(webhook.user_id, {
      type: 'webhook_failed',
      webhook_id: webhook.id,
      event,
      attempts,
      error: lastError.message
    });
  }
}

// Send HTTP request to webhook URL
async function sendWebhookRequest(
  url: string,
  payload: any,
  secret?: string,
  headers: Record<string, string> = {},
  timeout: number = 10000
): Promise<any> {
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Coreza-Webhooks/1.0',
    ...headers
  };

  // Add signature if secret is provided
  if (secret) {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    requestHeaders['X-Webhook-Signature'] = `sha256=${signature}`;
  }

  const response = await axios.post(url, payload, {
    headers: requestHeaders,
    timeout,
    validateStatus: (status) => status >= 200 && status < 300
  });

  return {
    status: response.status,
    data: response.data,
    headers: response.headers
  };
}

// Log webhook delivery attempt
async function logWebhookDelivery(
  webhookId: string,
  payload: any,
  success: boolean,
  statusCode: number,
  error: string | null,
  attempts: number
): Promise<void> {
  try {
    await supabase
      .from('webhook_deliveries')
      .insert({
        webhook_id: webhookId,
        payload,
        success,
        status_code: statusCode,
        error_message: error,
        attempts,
        delivered_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Failed to log webhook delivery:', error);
  }
}

// Get webhook delivery logs
router.get('/:webhookId/deliveries', async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const { user_id, limit = 50 } = req.query;
    
    if (!user_id) {
      throw createError('user_id is required', 400);
    }

    // Verify webhook belongs to user
    const { data: webhook, error: webhookError } = await supabase
      .from('webhooks')
      .select('id')
      .eq('id', webhookId)
      .eq('user_id', user_id)
      .single();

    if (webhookError || !webhook) {
      throw createError('Webhook not found', 404);
    }

    // Get delivery logs
    const { data, error } = await supabase
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_id', webhookId)
      .order('delivered_at', { ascending: false })
      .limit(parseInt(limit as string));

    if (error) {
      throw createError('Failed to fetch delivery logs', 500);
    }

    res.json({
      deliveries: data
    });
  } catch (error) {
    next(error);
  }
});

export default router;