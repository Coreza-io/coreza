import express, { Request } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/jwtAuth";
import { BacktestLifecycleAdapter } from "../backtest";
import { WorkflowExecutionService } from "../workflow/WorkflowExecutionService";
import { WorkflowLifecycleService } from "../workflow/WorkflowLifecycleService";
import { WorkflowQueryService } from "../workflow/WorkflowQueryService";
import { WorkflowRepository } from "../workflow/WorkflowRepository";
import { WorkflowRunRepository } from "../workflow/WorkflowRunRepository";
import { SchedulerLifecycleAdapter } from "../workflow/SchedulerLifecycleAdapter";
import { StreamingLifecycleAdapter } from "../workflow/StreamingLifecycleAdapter";
import {
  createWorkflowSchema,
  executeWorkflowSchema,
  scheduleWorkflowSchema,
  updateWorkflowSchema,
} from "../workflow/schemas";

const workflowRepo = new WorkflowRepository();
const runRepo = new WorkflowRunRepository();
const streaming = new StreamingLifecycleAdapter();
const scheduler = new SchedulerLifecycleAdapter();
const backtestAdapter = new BacktestLifecycleAdapter();

const lifecycleService = new WorkflowLifecycleService(
  workflowRepo,
  runRepo,
  streaming,
  scheduler,
  backtestAdapter,
);
const executionService = new WorkflowExecutionService(workflowRepo, runRepo);
const queryService = new WorkflowQueryService(workflowRepo, runRepo, scheduler);

const router = express.Router();
router.use(requireAuth);

function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw createError("Unauthorized", 401);
  }
  return userId;
}

function normalizeValidationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return createError(error.errors.map((issue) => issue.message).join(", "), 400);
  }
  return error;
}

router.get("/", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const workflows = await queryService.listWorkflows(userId);
    res.json({ workflows });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.post("/", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = createWorkflowSchema.parse(req.body);
    const workflow = await queryService.createWorkflow(userId, body);
    res.status(201).json({ workflow });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.put("/:workflowId", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = updateWorkflowSchema.parse(req.body);
    const workflow = await queryService.updateWorkflow(
      userId,
      req.params.workflowId,
      body,
    );
    res.json({ workflow });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.delete("/:workflowId", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await lifecycleService.deleteWorkflow(userId, req.params.workflowId);
    res.json({ message: "Workflow deleted successfully" });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.get("/:workflowId/runs", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const runs = await queryService.getWorkflowRuns(userId, req.params.workflowId);
    res.json({ runs });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.post("/:workflowId/execute", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const { input_data } = executeWorkflowSchema.parse(req.body);
    const result = await executionService.executeManual(
      userId,
      req.params.workflowId,
      input_data,
    );
    res.json(result);
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.put("/:workflowId/schedule", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const { is_active } = scheduleWorkflowSchema.parse(req.body);
    const result = await lifecycleService.setActivationState({
      userId,
      workflowId: req.params.workflowId,
      isActive: is_active,
    });
    res.json(result);
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.get("/scheduler/status", async (_req, res, next) => {
  try {
    const status = await queryService.getSchedulerStatus();
    res.json(status);
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.get("/:workflowId/runs/:runId/executions", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const executions = await queryService.getNodeExecutions(
      userId,
      req.params.workflowId,
      req.params.runId,
    );
    res.json({ executions });
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

router.get("/:workflowId/runs/:runId/status", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    const status = await queryService.getRunStatus(
      userId,
      req.params.workflowId,
      req.params.runId,
    );
    res.json(status);
  } catch (error) {
    next(normalizeValidationError(error));
  }
});

export default router;
