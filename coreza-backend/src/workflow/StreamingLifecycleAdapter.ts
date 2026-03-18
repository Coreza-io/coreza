import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { createError } from "../middleware/errorHandler";
import { WorkflowNode } from "../nodes/types";
import { RegistrationService } from "../services/RegistrationService";
import { bullMqJobQueue as jobQueue } from "../services/jobQueueManager";
import { SubscriptionService } from "../services/SubscriptionService";
import { parseSymbols, resolveStreamSourceId } from "./subscriptionPolicy";
import { classifyTrigger, findStreamingDataNodes } from "./triggerClassifier";

export class StreamingLifecycleAdapter {
  async activateStreaming(
    userId: string,
    workflowId: string,
    triggerNode: WorkflowNode,
    allNodes: any[],
    allEdges: any[],
  ): Promise<string> {
    const redis = getRedisCache();
    const nodeValues = (triggerNode as WorkflowNode & {
      values?: {
        scope?: string;
        onlyClosedBars?: boolean;
      };
    }).values;

    await redis.sadd(REDIS_CHANNELS.activeStreamingWorkflows(userId), workflowId);

    const sourceId = resolveStreamSourceId(triggerNode);
    if (!sourceId) {
      throw createError("Unknown streaming source", 400);
    }

    await RegistrationService.publishRegisterWorkflow({
      userId,
      workflowId,
      nodeId: triggerNode.id,
      source: sourceId,
      scope: (nodeValues?.scope as string) || "workflow",
      onlyClosedBars: nodeValues?.onlyClosedBars ?? true,
    });

    await jobQueue.startWorkflowRunner(workflowId, userId, allNodes, allEdges);
    return sourceId;
  }

  async deactivateStreaming(userId: string, workflowId: string): Promise<void> {
    const redis = getRedisCache();

    await redis.srem(REDIS_CHANNELS.activeStreamingWorkflows(userId), workflowId);
    await redis.del(REDIS_CHANNELS.workflowStreamFilter(userId, workflowId));
    await RegistrationService.publishUnregisterWorkflow({
      userId,
      workflowId,
      isTestListener: false,
    });
  }

  async unsubscribeStreamingNodes(
    userId: string,
    workflowId: string,
    nodes: WorkflowNode[],
  ): Promise<void> {
    const streamingNodes = findStreamingDataNodes(nodes);

    for (const node of streamingNodes) {
      const nodeValues = node.values || node.data?.values || {};
      const symbolArray = parseSymbols(nodeValues.symbols);
      const sourceId = resolveStreamSourceId(node);

      if (!sourceId) {
        continue;
      }

      await SubscriptionService.unsubscribe({
        source: sourceId as any,
        userId,
        workflowId,
        symbols: symbolArray,
      });
    }
  }

  async unregisterStreamingTriggers(userId: string, workflowId: string): Promise<void> {
    await RegistrationService.publishUnregisterWorkflow({ userId, workflowId });
    await jobQueue.stopWorkflowRunner(workflowId);
  }

  async cleanupWorkflowSubscriptions(userId: string, workflowId: string): Promise<void> {
    const redis = getRedisCache();
    const pattern = `md:user:${userId}:subscription:scope:workflow:${workflowId}:*:symbols`;

    // Key structure: md:user:{userId}:subscription:scope:workflow:{workflowId}:{source}:symbols
    //                 0    1     2         3        4       5          6          7        8
    const SOURCE_INDEX = 7;

    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const symbols = await redis.smembers(key);
        const source = key.split(":")[SOURCE_INDEX];

        if (symbols.length > 0 && source) {
          await SubscriptionService.unsubscribe({
            source: source as any,
            userId,
            workflowId,
            symbols,
            scope: "workflow",
            targetWorkflowId: workflowId,
          });
        }

        await redis.del(key);
      }
    } while (cursor !== "0");
  }

  async fullCleanup(
    userId: string,
    workflowId: string,
    nodes: WorkflowNode[],
    isActive: boolean,
  ): Promise<void> {
    const redis = getRedisCache();

    await redis.srem(REDIS_CHANNELS.activeStreamingWorkflows(userId), workflowId);
    await redis.del(REDIS_CHANNELS.workflowStreamFilter(userId, workflowId));

    if (isActive) {
      await this.unsubscribeStreamingNodes(userId, workflowId, nodes);

      const hasStreamingTrigger = nodes.some(
        (node) => classifyTrigger(node) === "streaming",
      );
      if (hasStreamingTrigger) {
        await this.unregisterStreamingTriggers(userId, workflowId);
      }
    }

    await this.cleanupWorkflowSubscriptions(userId, workflowId);
  }
}
