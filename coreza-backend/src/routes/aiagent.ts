import { resultFailure } from "../contracts/nodeResult";

import { toPublicNodeResult } from "../contracts/nodeResult";
/** Manual Agent JSON execution; activity is an optional, separately scoped channel. */
import { randomUUID } from "crypto";
import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { AIAgentExecutor } from "../nodes/executors/AIAgentExecutor";
import { WorkflowNode } from "../nodes/types";
import { activityBinding, registerActivity, claimActivity, cancelActivity,
  activitySnapshot, getActivitySummary, verifyActivityRevision } from "../agents/manualActivity";

const router = Router();
const aiAgentExecutor = new AIAgentExecutor();
router.use(requireAuth);
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 128;

router.post("/activity-scopes", (req: Request, res: Response) => {
  const body = req.body;
  if (!validId(body?.node_id) || !validId(body?.workflowSessionId) || !validId(body?.clientInvocationId)
    || !validId(body?.activityRevision) || (body.workflowId != null && !validId(body.workflowId))
    || !Array.isArray(body.support_nodes) || body.support_nodes.length > 256
    || body.support_nodes.some((node: any) => !validId(node?.id))
    || !Array.isArray(body.edges) || body.edges.length > 512
    || body.edges.some((edge: any) => !validId(edge?.id) || !validId(edge?.source) || !validId(edge?.target)))
    return res.status(400).json({ error: "Invalid Agent action scope" });
  try { res.json({ scopeId: registerActivity(req.user!.id, activityBinding(body)) }); }
  catch { res.status(503).json({ error: "Agent activity unavailable" }); }
});
router.get("/activity-scopes/:scopeId", (req: Request, res: Response) => {
  try { res.json(activitySnapshot(req.user!.id, String(req.params.scopeId))); }
  catch { res.status(404).json({ error: "Agent activity scope unavailable" }); }
});
router.post("/activity-scopes/:scopeId/cancel", (req: Request, res: Response) => {
  try { cancelActivity(req.user!.id, String(req.params.scopeId)); res.status(202).json({ success: true }); }
  catch { res.status(404).json({ error: "Agent activity scope unavailable" }); }
});

router.post("/execute", async (req: Request, res: Response) => {
  const controller = new AbortController();
  let scope: ReturnType<typeof claimActivity> | undefined;
  let scopeId: string | undefined;
  const abort = () => controller.abort();
  const onClose = () => { if (!res.writableEnded) abort(); };
  req.on("aborted", abort);
  res.on("close", onClose);
  const deadline = setTimeout(abort, 10 * 60_000);
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json(resultFailure("Unauthorized", { data: null }));
    const { node_id, nodeName, node_type, category, systemPrompt, userPrompt,
      temperature, maxIterations, returnIntermediateSteps,
      support_nodes: workflowNodes, edges: workflowEdges, workflowId } = req.body;
    if (!userPrompt) return res.status(400).json(resultFailure("userPrompt is required", { data: null }));
    if (!Array.isArray(workflowNodes) || !Array.isArray(workflowEdges))
      return res.status(400).json(resultFailure("support_nodes and edges arrays are required", { data: null }));
    if (req.body.activityScopeId) {
      scopeId = req.body.activityScopeId;
      try {
        if (!verifyActivityRevision(req.body)) throw new Error("Agent action revision mismatch");
        scope = claimActivity(userId, scopeId!, activityBinding(req.body));
      }
      catch (error) {
        // Another gateway/process or expired telemetry must not fail the action.
        if ((error as Error).message !== "Agent activity scope unavailable")
          return res.status(409).json(resultFailure("Agent action scope does not match or was already used", { data: null }));
        scopeId = undefined;
      }
      scope?.signal.addEventListener("abort", abort, { once: true });
      if (scope?.signal.aborted) abort();
    }
    const node: WorkflowNode = { id: node_id, name: nodeName, node_type, category,
      values: { systemPrompt, userPrompt, temperature, maxIterations, returnIntermediateSteps } };
    const editorSession = req.body.workflowSessionId || randomUUID();
    const context = {
      userId, nodes: workflowNodes, edges: workflowEdges,
      workflowId: workflowId || editorSession, executionId: editorSession,
      abortSignal: controller.signal,
      clientInvocationId: scope ? req.body.clientInvocationId : undefined,
      agentActivitySink: scope, onAgentActivityRecorder: scope?.attach,
      resolveNodeParameters: (current: WorkflowNode, input: any) => ({ ...current.values, ...input }),
    };
    const result = await aiAgentExecutor.execute(node, {}, context);
    const agentActivity = scopeId ? getActivitySummary(userId, scopeId) : undefined;
    res.status(result.status === "error" ? 500 : 200).json({ ...toPublicNodeResult(result), ...(agentActivity ? { agentActivity } : {}) });
  } catch (error: any) {
    const cancelled = controller.signal.aborted || error?.name === "AbortError";
    const agentActivity = scopeId && req.user ? getActivitySummary(req.user.id, scopeId) : undefined;
    if (!res.destroyed) res.status(cancelled ? 499 : 500).json({
      ...resultFailure(cancelled ? "Agent execution cancelled" : error.message || "AI Agent execution failed", {
        ...(cancelled ? { details: { code: "CANCELLED" } } : {}),
      }),
      ...(cancelled ? { status: "cancelled" } : {}),
      ...(agentActivity ? { agentActivity } : {}),
    });
  } finally {
    clearTimeout(deadline);
    req.off("aborted", abort);
    res.off("close", onClose);
    scope?.signal.removeEventListener("abort", abort);
  }
});
export default router;
