/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import express from "express";
import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/jwtAuth";
import { bullMqJobQueue as jobQueue } from "../services/jobQueueManager";
import { RegistrationService } from "../services/RegistrationService";
import { SubscriptionService } from "../services/SubscriptionService";
import CronExpressionParser from "cron-parser";
import { toZonedTime, formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { buildStoreKey, getStoreValue, setStoreValue } from "../utils/store";
import { calculateSchedule } from "../utils/scheduleUtils";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// Map node names to WebSocket source IDs for control messages
const nodeNameToSourceMap: Record<string, string> = {
  BinanceStreamData: "binance_stream",
  AlpacaStreamData: "alpaca_stream",
  AlpacaNews: "alpaca_news",
  DhanStreamData: "dhan_stream",
};

const resolveStreamSourceId = (node: any): string | null => {
  const baseSource = node?.subCategory || nodeNameToSourceMap[node?.name];
  if (!baseSource) {
    return null;
  }

  const dataType = node?.values?.data_type ?? node?.data?.values?.data_type;
  return dataType ? `${baseSource}_${dataType}` : baseSource;
};

const parseSymbols = (symbols: unknown): string[] => {
  if (typeof symbols === "string") {
    return symbols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (Array.isArray(symbols)) {
    return symbols.filter((s): s is string => typeof s === "string");
  }

  return [];
};

const cleanupWorkflowSubscriptions = async (
  userId: string,
  workflowId: string,
) => {
  const redis = getRedisCache();
  const workflowSubscriptionKeys = await redis.keys(
    `md:user:${userId}:subscription:scope:workflow:${workflowId}:*:symbols`,
  );

  for (const key of workflowSubscriptionKeys) {
    const symbols = await redis.smembers(key);
    const source = key.split(":")[7];

    if (symbols.length > 0 && source) {
      await SubscriptionService.unsubscribe({
        source,
        userId,
        workflowId,
        symbols,
        scope: "workflow",
        targetWorkflowId: workflowId,
      });

      console.log(
        `📡 [Workflow Route] Unsubscribed ${symbols.length} symbols from ${source} for workflow ${workflowId}`,
      );
    }

    await redis.del(key);
  }
};

// Get all workflows for a user
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflows", 500);
    }

    res.json({ workflows: data });
  } catch (error) {
    next(error);
  }
});

// Create a new workflow
router.post("/", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, nodes, edges, project_id, schedule_cron } = req.body;

    if (!name || !nodes || !edges) {
      throw createError("Name, nodes, and edges are required", 400);
    }

    const { data, error } = await supabase
      .from("workflows")
      .insert({
        user_id: userId,
        name,
        nodes,
        edges,
        project_id,
        schedule_cron,
        is_active: false,
      })
      .select()
      .single();

    if (error) {
      throw createError("Failed to create workflow", 500);
    }

    res.status(201).json({ workflow: data });
  } catch (error) {
    next(error);
  }
});

// Update a workflow
router.put("/:workflowId", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.params;
    const updates = req.body;

    const { data, error } = await supabase
      .from("workflows")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw createError("Failed to update workflow", 500);
    }

    if (!data) {
      throw createError("Workflow not found", 404);
    }

    res.json({ workflow: data });
  } catch (error) {
    next(error);
  }
});

// Delete a workflow
router.delete("/:workflowId", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.params;

    // Fetch workflow to check for active subscriptions
    const { data: workflow } = await supabase
      .from("workflows")
      .select("nodes, is_active")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    // Clean up active subscriptions before deletion
    if (workflow) {
      const redis = getRedisCache();

      // Unschedule if has Scheduler node
      await jobQueue.unscheduleWorkflow(workflowId);

      // Clean up streaming workflow from active set and filter config
      await redis.srem(
        REDIS_CHANNELS.activeStreamingWorkflows(userId),
        workflowId,
      );
      await redis.del(REDIS_CHANNELS.workflowStreamFilter(userId, workflowId));

      // Unsubscribe from market data if has streaming nodes (AlpacaNews, AlpacaStreamData, BinanceStreamData, etc.)
      const streamingNodes = workflow.nodes?.filter(
        (n: any) =>
          n.name === "AlpacaNews" ||
          n.type === "AlpacaNews" ||
          n.name === "AlpacaStreamData" ||
          n.type === "AlpacaStreamData" ||
          n.name === "BinanceStreamData" ||
          n.type === "BinanceStreamData" ||
          n.name === "DhanStreamData" ||
          n.type === "DhanStreamData",
      );

      if (streamingNodes && streamingNodes.length > 0 && workflow.is_active) {
        for (const node of streamingNodes) {
          const nodeValues = node.values || node.data?.values || {};
          const symbolArray = parseSymbols(nodeValues.symbols);
          const sourceId = resolveStreamSourceId(node);

          if (!sourceId) {
            continue;
          }

          await SubscriptionService.unsubscribe({
            source: sourceId,
            userId,
            workflowId,
            symbols: symbolArray,
          });

          console.log(
            `📤 [Workflow Delete] Published unsubscribe control message for ${sourceId}:`,
            symbolArray,
          );
        }
      }

      // Also unsubscribe streaming trigger workflows from MarketDataSubscriber
      const streamingTriggers = workflow.nodes?.filter(
        (n: any) =>
          n.node_type === "trigger" && n.executionMode === "streaming",
      );

      for (const trigger of streamingTriggers || []) {
        await RegistrationService.publishUnregisterWorkflow({
          userId,
          workflowId,
        });
        await jobQueue.stopLiveStrategy(workflowId);
        console.log(
          `📤 [Workflow Delete] Unregistered streaming workflow ${workflowId} from MarketDataSubscriber`,
        );
      }

      await cleanupWorkflowSubscriptions(userId, workflowId);
    }

    const { error } = await supabase
      .from("workflows")
      .delete()
      .eq("id", workflowId)
      .eq("user_id", userId);

    if (error) {
      throw createError("Failed to delete workflow", 500);
    }

    res.json({ message: "Workflow deleted successfully" });
  } catch (error) {
    next(error);
  }
});

// Get workflow runs
router.get("/:workflowId/runs", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.params;

    // First verify workflow belongs to user
    const { data: workflow } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (!workflow) {
      throw createError("Workflow not found", 404);
    }

    const { data, error } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("started_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflow runs", 500);
    }

    res.json({ runs: data });
  } catch (error) {
    next(error);
  }
});

// Execute workflow
router.post("/:workflowId/execute", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.params;
    const { input_data = {} } = req.body;

    // First verify workflow belongs to user and is active
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (workflowError || !workflow) {
      throw createError("Workflow not found", 404);
    }

    // Create workflow run with snapshot of current workflow state
    const { data: run, error: runError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_id: workflowId,
        status: "queued",
        initiated_by: userId,
        nodes: workflow.nodes,
        edges: workflow.edges,
        node_count: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
        edge_count: Array.isArray(workflow.edges) ? workflow.edges.length : 0,
      })
      .select()
      .single();

    if (runError) {
      throw createError("Failed to create workflow run", 500);
    }

    await jobQueue.addWorkflowExecution({
      runId: run.id,
      workflowId,
      userId,
      nodes: workflow.nodes,
      edges: workflow.edges,
      trigger: "manual",
    });

    res.json({
      run_id: run.id,
      status: "queued",
      message: "Workflow execution queued",
    });
  } catch (error) {
    next(error);
  }
});

type SchedulerValues = {
  mode?: "every" | "daily" | "weekly" | "monthly" | "cron";
  interval?: "Minutes" | "Hours" | "Days" | "Weeks" | "Months" | "Cron";
  count?: string | number;
  minute?: string | number;
  hour?: string | number;
  dom?: string | number;
  dow?: Array<string | number>;
  cron?: string;
  timezone?: string;
};

function computeCron(node: any): {
  cron: string;
  timezone: string;
  next: string;
} {
  const SchedulerValues = (node.values ?? {}) as any;

  const scheduleResult = calculateSchedule({
    interval: SchedulerValues.interval,
    mode: SchedulerValues.mode,
    count: SchedulerValues.count,
    minute: SchedulerValues.minute,
    hour: SchedulerValues.hour,
    dom: SchedulerValues.dom,
    dow: SchedulerValues.dow,
    cron: SchedulerValues.cron,
    timezone: SchedulerValues.timezone,
  });

  const cron = scheduleResult.cronExpression;
  const tz = SchedulerValues.timezone;

  // Validate cron & ensure a future run with 1-minute buffer

  const cronExpression = CronExpressionParser.parse(cron, { tz });
  let next = cronExpression.next().toDate();
  const scheduledHour = scheduleResult.scheduleHour;
  const scheduledMinute = scheduleResult.scheduleMinute;
  const toScheduledUtc = (date: Date): Date => {
    const zoned = toZonedTime(date, tz);
    zoned.setHours(scheduledHour, scheduledMinute, 0, 0);
    return fromZonedTime(zoned, tz);
  };
  let nextInTZ = toScheduledUtc(next);
  const now = new Date();
  const oneMinuteFromNow = new Date(now.getTime() + 60 * 1000);

  // Auto-skip occurrences that are too close (< 1 minute buffer)
  if (nextInTZ < oneMinuteFromNow) {
    throw createError(
      "Invalid cron expression: unable to find a valid future execution time within 100 iterations",
      400,
    );
  }

  return { cron, timezone: tz, next: nextInTZ.toISOString() };
}

// Activate/Deactivate workflow scheduling and triggers
router.put("/:workflowId/schedule", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.params;
    const { is_active } = req.body ?? {};

    // Fetch workflow
    const { data: workflow, error } = await supabase
      .from("workflows")
      .select("id,user_id,nodes,edges,is_active,schedule_cron")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows found
        throw createError("Workflow not found", 404);
      }
      throw createError(error.message, 500);
    }

    // Detect trigger nodes
    const triggerNodes = workflow.nodes.filter(
      (n: any) => n.node_type === "trigger" || n.node_type === "backtest",
    );

    if (triggerNodes.length === 0) {
      throw createError(
        "No trigger node (Scheduler, Streaming or WebhookTrigger) found in workflow",
        400,
      );
    }

    if (triggerNodes.length > 1) {
      throw createError("Workflow can only contain one trigger node", 400);
    }
    const triggerNode = triggerNodes[0];

    let cronToSave: string | null = null;
    let tzToUse = "UTC";
    let nextRun: string | null = null;
    let newsSubscription: { symbols: string[] } | null = null;
    let activatedBacktestId: string | null = null;

    try {
      if (is_active) {
        // Handle Scheduler activation
        if (triggerNode.name == "Scheduler") {
          const { cron, timezone, next } = computeCron(triggerNode);
          tzToUse = timezone ?? "UTC";
          nextRun = next;

          await jobQueue.scheduleWorkflow(workflowId, userId, cron, tzToUse);
        }

        // Handle streaming trigger node activation (AlpacaStreamData, BinanceStreamData)
        // These are now pure data receivers - subscriptions are managed by separate Subscribe nodes
        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.executionMode == "streaming"
        ) {
          const nodeValues = triggerNode.values || {};

          const redis = getRedisCache();

          // Store workflow in active streaming workflows set for this user
          await redis.sadd(
            REDIS_CHANNELS.activeStreamingWorkflows(userId),
            workflowId,
          );

          const sourceId = resolveStreamSourceId(triggerNode);

          if (!sourceId) {
            throw createError("Unknown streaming source", 400);
          }

          // Get subscription mode - determines whether to receive global or workflow-scoped data only
          const scope = nodeValues.scope;

          // Get onlyClosedBars setting - filters unclosed Binance klines (default: true)
          const onlyClosedBars = nodeValues.onlyClosedBars ?? true;

          await RegistrationService.publishRegisterWorkflow({
            userId,
            workflowId,
            nodeId: triggerNode.id,
            source: sourceId,
            scope,
            onlyClosedBars,
          });

          await jobQueue.startLiveStrategy(
            workflowId,
            userId,
            workflow.nodes as any[],
            workflow.edges as any[],
          );

          console.log(
            `📡 [Workflow Route] Streaming workflow ${workflowId} activated and registered with market-stream-service`,
            {
              sourceId,
            },
          );
        }

        // Handle WebhookTrigger activation
        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.executionMode == "webhook_listening"
        ) {
          // For WebhookTrigger - no external service to call
          // The WebhookService.handleIncoming() will check is_active and route to BullMQ
          console.log(
            `🪝 [Workflow Route] WebhookTrigger activated for workflow ${workflowId}`,
          );
        }

        // Handle BacktestInit activation - execute init directly and start runner
        if (triggerNode.node_type === "backtest") {
          // No workflow_runs row -- backtests use their own `backtests` table
          const tempRunId = `bt-${Date.now()}`;
          try {
            activatedBacktestId = await jobQueue.startBacktest(
              tempRunId,
              workflowId,
              userId,
              workflow.nodes as any[],
              workflow.edges as any[],
              triggerNode as any,
            );

            console.log(
              `📊 [Workflow Route] BacktestInit workflow ${workflowId} started directly`,
            );
          } catch (error: any) {
            // Mark the backtest row as failed
            await supabase
              .from("backtests")
              .update({
                status: "failed",
                completed_at: new Date().toISOString(),
                error_message: error?.message || "Backtest initialization failed",
              })
              .eq("workflow_id", workflowId)
              .in("status", ["pending", "running"]);

            console.error(
              `Failed to start backtest for workflow ${workflowId}: ${error?.message || error}`,
            );
          }
        }
      } else {
        // Deactivate - unschedule, unsubscribe, and cancel running jobs

        // Cancel all running/queued jobs for this workflow
        const cancelledJobs = await jobQueue.cancelWorkflowJobs(
          userId,
          workflowId,
        );
        console.log(
          `🛑 Cancelled ${cancelledJobs} running/queued jobs for workflow ${workflowId}`,
        );

        // Mark any "running" or "queued" workflow runs as cancelled
        if (cancelledJobs > 0) {
          const { data: cancelledRuns, error: runUpdateError } = await supabase
            .from("workflow_runs")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              error_message: "Workflow deactivated by user",
            })
            .eq("workflow_id", workflowId)
            .in("status", ["running", "queued"])
            .select("id");

          if (cancelledRuns?.length) {
            console.log(
              `🛑 Marked ${cancelledRuns.length} workflow runs as cancelled`,
            );
          }
        }

        // If this is a backtest workflow, cancel any active backtests
        if (
          triggerNode?.node_type === "backtest" ||
          triggerNode?.name === "BacktestInit"
        ) {
          const { data: activeBacktests, error: btError } = await supabase
            .from("backtests")
            .select("id")
            .eq("workflow_id", workflowId)
            .in("status", ["pending", "running"]);

          if (activeBacktests?.length) {
            await supabase
              .from("backtests")
              .update({
                status: "cancelled",
                completed_at: new Date().toISOString(),
                error_message: "Workflow deactivated by user",
              })
              .eq("workflow_id", workflowId)
              .in("status", ["pending", "running"]);

            console.log(
              `🛑 Cancelled ${activeBacktests.length} active backtests for workflow ${workflowId}`,
            );
          }
        }

        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.subCategory == "webhook"
        ) {
          console.log(
            `🪝 [Workflow Route] WebhookTrigger deactivated for workflow ${workflowId}`,
          );
        }

        // Handle streaming trigger deactivation
        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.executionMode == "streaming"
        ) {
          const redis = getRedisCache();

          // Remove workflow from active streaming workflows set
          await redis.srem(
            REDIS_CHANNELS.activeStreamingWorkflows(userId),
            workflowId,
          );

          // Publish unregister message to market-stream-service
          await RegistrationService.publishUnregisterWorkflow({
            userId,
            workflowId,
            isTestListener: false,
          });

          await jobQueue.stopLiveStrategy(workflowId);

          console.log(
            `📡 [Workflow Route] Streaming workflow ${workflowId} deactivated and unregistered from market-stream-service`,
          );
        }

        // Clean up workflow-scoped symbol subscriptions (from Subscribe nodes like BinanceSubscribe, AlpacaSubscribe, DhanSubscribe)
        await cleanupWorkflowSubscriptions(userId, workflowId);
      }

      // Persist workflow state
      const { data: updated, error: updateError } = await supabase
        .from("workflows")
        .update({
          is_active: !!is_active,
          schedule_cron: is_active ? cronToSave : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", workflowId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateError || !updated)
        throw createError("Failed to update workflow", 500);

      // Build response message
      let message = "";
      if (is_active) {
        const parts = [];
        if (triggerNode.name == "Scheduler") parts.push("scheduled");
        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.executionMode == "streaming"
        )
          parts.push(
            `subscribed to news for ${newsSubscription?.symbols.join(", ")}`,
          );
        if (
          triggerNode.node_type == "trigger" &&
          triggerNode.executionMode == "webhook_listening"
        )
          parts.push("webhook listener activated");
        if (triggerNode.name === "BacktestInit")
          parts.push("backtest workflow activated");
        message = `Workflow ${parts.join(" and ")}`;
      } else {
        message = "Workflow deactivated";
      }

      res.json({
        workflow: updated,
        next_run_at: is_active && nextRun ? nextRun : null,
        news_subscription: is_active ? newsSubscription : null,
        backtestId: is_active ? activatedBacktestId : null,
        message,
      });
    } catch (e: any) {
      // Rollback on error
      await supabase
        .from("workflows")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", workflowId)
        .eq("user_id", userId);
      throw createError(`Activation failed: ${e.message}`, 502);
    }
  } catch (err) {
    next(err);
  }
});

// Get scheduler status
router.get("/scheduler/status", async (req, res, next) => {
  try {
    const scheduledJobs = await jobQueue.getScheduledJobs();

    res.json({
      status: "active",
      scheduled_workflows: scheduledJobs.length,
      jobs: scheduledJobs.map((job) => ({
        workflow_id: job.id?.startsWith("schedule:")
          ? job.id.replace("schedule:", "")
          : job.id,
        cron_expression: job.pattern,
        timezone: job.timezone || "UTC",
        next_run: job.next
          ? formatInTimeZone(
              job.next,
              job.timezone || "UTC",
              "yyyy-MM-dd HH:mm:ssXXX",
            )
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get node execution details for a workflow run
router.get("/:workflowId/runs/:runId/executions", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId, runId } = req.params;

    // Verify workflow belongs to user
    const { data: workflow } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (!workflow) {
      throw createError("Workflow not found", 404);
    }

    // Get node executions
    const { data, error } = await supabase
      .from("node_executions")
      .select("*")
      .eq("run_id", runId)
      .order("started_at", { ascending: true });

    if (error) {
      throw createError("Failed to fetch node executions", 500);
    }

    res.json({ executions: data });
  } catch (error) {
    next(error);
  }
});

// Get workflow run status
router.get("/:workflowId/runs/:runId/status", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId, runId } = req.params;

    // Verify workflow belongs to user
    const { data: workflow } = await supabase
      .from("workflows")
      .select("id")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (!workflow) {
      throw createError("Workflow not found", 404);
    }

    // Get workflow run
    const { data: run, error: runError } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("id", runId)
      .single();

    if (runError || !run) {
      throw createError("Workflow run not found", 404);
    }

    // Get node executions count
    const { count, error: countError } = await supabase
      .from("node_executions")
      .select("*", { count: "exact", head: true })
      .eq("run_id", runId);

    if (countError) {
      console.error("Failed to count node executions:", countError);
    }

    res.json({
      run,
      node_executions_count: count || 0,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
