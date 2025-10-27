import crypto from 'crypto';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';

export interface WebhookInput {
  user_id: string;
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  headers?: Record<string, string>;
  retry_attempts?: number;
  timeout?: number;
  webhook_id?: string;
  event?: string;
  data?: any;
}

export interface WebhookResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class WebhookService {
  static async execute(operation: string, input: WebhookInput): Promise<WebhookResult> {
    try {
      let result;
      switch (operation) {
        case 'register':
          result = await this.registerWebhook(input);
          break;
        case 'update':
          result = await this.updateWebhook(input);
          break;
        case 'delete':
          result = await this.deleteWebhook(input);
          break;
        case 'list':
          result = await this.listWebhooks(input);
          break;
        case 'test':
          result = await this.testWebhook(input);
          break;
        case 'trigger':
          result = await this.triggerWebhook(input);
          break;
        default:
          throw createError(`Unsupported webhook operation: ${operation}`, 400);
      }

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private static async registerWebhook(input: WebhookInput): Promise<any> {
    const { user_id, name, url, secret, events, headers, retry_attempts = 3, timeout = 10000 } = input;
    
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

      await this.sendWebhookRequest(url, testPayload, secret, headers, timeout);
    } catch (error: any) {
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

    return {
      webhook: data,
      message: 'Webhook registered successfully'
    };
  }

  private static async updateWebhook(input: WebhookInput): Promise<any> {
    const { webhook_id, user_id, url, secret, events, headers, retry_attempts, timeout } = input;
    
    if (!webhook_id || !user_id) {
      throw createError('webhook_id and user_id are required', 400);
    }

    const updateData: any = {};
    if (url) updateData.url = url;
    if (secret !== undefined) updateData.secret = secret;
    if (events) updateData.events = events;
    if (headers) updateData.headers = headers;
    if (retry_attempts) updateData.retry_attempts = retry_attempts;
    if (timeout) updateData.timeout = timeout;

    const { data, error } = await supabase
      .from('webhooks')
      .update(updateData)
      .eq('id', webhook_id)
      .eq('user_id', user_id)
      .select()
      .single();

    if (error || !data) {
      throw createError('Webhook not found or update failed', 404);
    }

    return {
      webhook: data,
      message: 'Webhook updated successfully'
    };
  }

  private static async deleteWebhook(input: WebhookInput): Promise<any> {
    const { webhook_id, user_id } = input;
    
    if (!webhook_id || !user_id) {
      throw createError('webhook_id and user_id are required', 400);
    }

    const { error } = await supabase
      .from('webhooks')
      .delete()
      .eq('id', webhook_id)
      .eq('user_id', user_id);

    if (error) {
      throw createError('Failed to delete webhook', 500);
    }

    return {
      message: 'Webhook deleted successfully'
    };
  }

  private static async listWebhooks(input: WebhookInput): Promise<any> {
    const { user_id } = input;
    
    if (!user_id) {
      throw createError('user_id is required', 400);
    }

    const { data, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false });

    if (error) {
      throw createError('Failed to fetch webhooks', 500);
    }

    return {
      webhooks: data
    };
  }

  private static async testWebhook(input: WebhookInput): Promise<any> {
    const { webhook_id, user_id, data: test_data } = input;
    
    if (!webhook_id || !user_id) {
      throw createError('webhook_id and user_id are required', 400);
    }

    // Get webhook configuration
    const { data: webhook, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('id', webhook_id)
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

    const result = await this.sendWebhookRequest(
      webhook.url,
      testPayload,
      webhook.secret,
      webhook.headers,
      webhook.timeout
    );

    return {
      result,
      message: 'Webhook test completed successfully'
    };
  }

  private static async triggerWebhook(input: WebhookInput): Promise<any> {
    const { user_id, event, data } = input;
    
    if (!user_id || !event || !data) {
      throw createError('user_id, event, and data are required', 400);
    }

    // Get active webhooks for user that listen to this event
    const { data: webhooks, error } = await supabase
      .from('webhooks')
      .select('*')
      .eq('user_id', user_id)
      .eq('active', true);

    if (error) {
      throw createError('Failed to fetch webhooks', 500);
    }

    const relevantWebhooks = webhooks.filter(webhook => 
      webhook.events.includes(event) || webhook.events.includes('*')
    );

    if (relevantWebhooks.length === 0) {
      return {
        message: 'No webhooks found for this event',
        triggered: 0
      };
    }

    // Send webhooks
    const results = await Promise.allSettled(
      relevantWebhooks.map(webhook => 
        this.processWebhookNotification({
          webhook,
          event,
          payload: data
        })
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    return {
      message: `Triggered ${relevantWebhooks.length} webhooks`,
      triggered: relevantWebhooks.length,
      successful,
      failed
    };
  }

  // Process webhook notification
  static async processWebhookNotification(data: any): Promise<void> {
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

        const result = await this.sendWebhookRequest(
          webhook.url,
          webhookPayload,
          webhook.secret,
          webhook.headers,
          webhook.timeout
        );

        success = true;
        
        // Log successful delivery
        await this.logWebhookDelivery(webhook.id, webhookPayload, true, result.status, null, attempts);
        
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
      await this.logWebhookDelivery(webhook.id, webhookPayload, false, 0, lastError.message, attempts);
    }
  }

  // Send HTTP request to webhook URL
  private static async sendWebhookRequest(
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
  private static async logWebhookDelivery(
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
}