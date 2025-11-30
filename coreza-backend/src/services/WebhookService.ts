import { createHmac } from 'crypto';
import { supabase } from '../config/supabase';
import { bullMqJobQueue } from './jobQueueManager';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../utils/logger';

const logger = createLogger('WebhookService');

export interface NormalizedWebhookPayload {
  timestamp: string;
  method: string;
  headers: Record<string, any>;
  body: any;
  query: Record<string, any>;
  raw: any;
}

export class WebhookService {
  private static instance: WebhookService;

  private constructor() {}

  static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  /**
   * Generate callback URL for webhook
   */
  generateCallbackUrl(userId: string, workflowId: string, nodeId: string): string {
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    return `${baseUrl}/webhooks/incoming/${userId}/${workflowId}/${nodeId}`;
  }

  /**
   * Handle incoming webhook request with dual execution paths
   */
  async handleIncoming(params: {
    userId: string;
    workflowId: string;
    nodeId: string;
    method: string;
    headers: Record<string, any>;
    body: any;
    query: Record<string, any>;
  }): Promise<void> {
    const { userId, workflowId, nodeId, method, headers, body, query } = params;

    logger.info(
      { workflowId, nodeId, method },
      'Incoming webhook request'
    );

    try {
      // Fetch workflow from database
      const { data: workflow, error: workflowError } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', workflowId)
        .eq('user_id', userId)
        .single();

      if (workflowError || !workflow) {
        logger.warn({ workflowId, nodeId }, 'Workflow not found');
        return; // Return 200 to prevent external service retries
      }

      // Find node configuration in workflow
      const nodes = workflow.nodes as any[];
      const node = nodes.find((n: any) => n.id === nodeId);

      if (!node) {
        logger.warn({ workflowId, nodeId }, 'Node not found in workflow');
        return;
      }

      // Extract node configuration
      const nodeConfig = node.data?.values || node.values || {};

      // Apply filters
      if (!this.applyFilters(nodeConfig, method, headers, body)) {
        logger.info(
          { workflowId, nodeId },
          'Webhook filtered out by node configuration'
        );
        return;
      }

      // Normalize payload
      const normalizedPayload = this.normalizePayload(method, headers, body, query);

      if (workflow.is_active) {
        // MODE 2: Backend execution via BullMQ (Activated workflow)
        logger.info(
          { workflowId, nodeId, mode: 'backend' },
          'Webhook triggering backend execution for active workflow'
        );

        // Create workflow run
        const { data: run, error: runError } = await supabase
          .from('workflow_runs')
          .insert({
            workflow_id: workflowId,
            status: 'queued',
            initiated_by: userId,
          })
          .select()
          .single();

        if (runError) {
          logger.error({ err: runError }, 'Failed to create workflow run');
          return;
        }

        // Queue workflow execution with webhook payload as initial input
        await bullMqJobQueue.addWorkflowExecution({
          runId: run.id,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          trigger: 'webhook',
          initialInput: {
            webhookPayload: normalizedPayload,
          },
        });

        logger.info(
          { workflowId, nodeId, runId: run.id },
          'Workflow queued for backend execution'
        );
      } else {
        // MODE 1: Push to frontend via WebSocket (Manual run)
        logger.info(
          { workflowId, nodeId, mode: 'frontend' },
          'Webhook pushing to frontend for manual run'
        );

        const { getRedis } = await import('../config/redis');
        const redis = getRedis();
        
        await redis.publish(`ws:user:${userId}`, JSON.stringify({
          type: 'webhook_event',
          workflowId,
          nodeId,
          payload: normalizedPayload,
          timestamp: new Date().toISOString()
        }));

        logger.info(
          { workflowId, nodeId, userId },
          'Webhook data pushed to frontend via WebSocket'
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Error handling incoming webhook');
      // Still return successfully to prevent external retries
    }
  }

  /**
   * Apply filters based on node configuration
   */
  private applyFilters(
    nodeConfig: any,
    method: string,
    headers: Record<string, any>,
    body: any
  ): boolean {
    // Verify signature if secret is configured
    if (nodeConfig.secret) {
      const signature = headers['x-webhook-signature'] || headers['x-hub-signature-256'];
      if (!signature) {
        logger.warn('Missing signature header');
        return false;
      }

      const isValid = this.verifySignature(
        nodeConfig.secret,
        JSON.stringify(body),
        signature
      );

      if (!isValid) {
        logger.warn('Invalid signature');
        return false;
      }
    }

    // Filter by method if configured
    if (nodeConfig.filterMethods && Array.isArray(nodeConfig.filterMethods)) {
      if (!nodeConfig.filterMethods.includes(method)) {
        logger.info({ method, allowed: nodeConfig.filterMethods }, 'Method not allowed');
        return false;
      }
    }

    // Filter by event type header if configured
    if (nodeConfig.filterEvents && Array.isArray(nodeConfig.filterEvents)) {
      const eventType = headers['x-event-type'] || headers['x-github-event'];
      if (eventType && !nodeConfig.filterEvents.includes(eventType)) {
        logger.info({ eventType, allowed: nodeConfig.filterEvents }, 'Event type not allowed');
        return false;
      }
    }

    return true;
  }

  /**
   * Verify HMAC signature
   */
  private verifySignature(secret: string, payload: string, signature: string): boolean {
    try {
      // Support multiple signature formats
      const sha256Prefix = 'sha256=';
      const sha1Prefix = 'sha1=';

      let algorithm = 'sha256';
      let expectedSignature = signature;

      if (signature.startsWith(sha256Prefix)) {
        expectedSignature = signature.slice(sha256Prefix.length);
      } else if (signature.startsWith(sha1Prefix)) {
        algorithm = 'sha1';
        expectedSignature = signature.slice(sha1Prefix.length);
      }

      const hmac = createHmac(algorithm, secret);
      hmac.update(payload);
      const calculatedSignature = hmac.digest('hex');

      return calculatedSignature === expectedSignature;
    } catch (error) {
      logger.error({ err: error }, 'Error verifying signature');
      return false;
    }
  }

  /**
   * Normalize webhook payload to standard format
   */
  private normalizePayload(
    method: string,
    headers: Record<string, any>,
    body: any,
    query: Record<string, any>
  ): NormalizedWebhookPayload {
    return {
      timestamp: new Date().toISOString(),
      method,
      headers: {
        ...headers,
        // Remove sensitive headers
        authorization: headers.authorization ? '[REDACTED]' : undefined,
      },
      body,
      query,
      raw: {
        method,
        headers,
        body,
        query,
      },
    };
  }

  /**
   * Get webhook status
   */
  async getStatus(workflowId: string, nodeId: string): Promise<{
    active: boolean;
    callbackUrl?: string;
    error?: string;
  }> {
    try {
      const { data: workflow, error } = await supabase
        .from('workflows')
        .select('nodes, is_active, user_id')
        .eq('id', workflowId)
        .single();

      if (error || !workflow) {
        return { active: false, error: 'Workflow not found' };
      }

      const nodes = workflow.nodes as any[];
      const node = nodes.find((n: any) => n.id === nodeId);

      if (!node) {
        return { active: false, error: 'Node not found' };
      }

      const callbackUrl = this.generateCallbackUrl(
        workflow.user_id,
        workflowId,
        nodeId
      );

      return {
        active: workflow.is_active,
        callbackUrl,
      };
    } catch (error) {
      logger.error({ err: error }, 'Error getting webhook status');
      return {
        active: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const webhookService = WebhookService.getInstance();
