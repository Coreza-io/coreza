import { Router, Request, Response } from "express";
import { AIAgentExecutor } from "../nodes/executors/AIAgentExecutor";
import { WorkflowNode } from "../nodes/types";

const router = Router();
const aiAgentExecutor = new AIAgentExecutor();

router.post("/execute", async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      systemPrompt,
      userPrompt,
      temperature,
      maxIterations,
      returnIntermediateSteps,
      nodes: workflowNodes,
      edges: workflowEdges,
      ...restFields
    } = req.body;

    console.log("🤖 [AI AGENT ROUTE] Received execution request");
    console.log("🤖 [AI AGENT ROUTE] User ID:", user_id);
    console.log("🤖 [AI AGENT ROUTE] Nodes count:", workflowNodes?.length || 0);
    console.log("🤖 [AI AGENT ROUTE] Edges count:", workflowEdges?.length || 0);

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: "user_id is required",
      });
    }

    if (!userPrompt) {
      return res.status(400).json({
        success: false,
        error: "userPrompt is required",
      });
    }

    if (!workflowNodes || !Array.isArray(workflowNodes)) {
      return res.status(400).json({
        success: false,
        error: "nodes array is required for AI Agent to discover tool nodes",
      });
    }

    if (!workflowEdges || !Array.isArray(workflowEdges)) {
      return res.status(400).json({
        success: false,
        error: "edges array is required for AI Agent to discover tool nodes",
      });
    }

    // Find the AIAgent node from the workflow nodes
    const aiAgentNode = workflowNodes.find((n) => n.type === "AIAgent");
    if (!aiAgentNode) {
      return res.status(400).json({
        success: false,
        error: "AIAgent node not found in workflow nodes",
      });
    }

    // Construct the node with values from request
    const node: WorkflowNode = {
      id: aiAgentNode.id,
      node_type: "AIAgent",
      category: "LLM",
      values: {
        systemPrompt,
        userPrompt,
        temperature,
        maxIterations,
        returnIntermediateSteps,
        ...restFields,
      },
    };

    // Create execution context with all necessary data
    const context = {
      user_id,
      userId: user_id,
      nodes: workflowNodes,
      edges: workflowEdges,
      // Add a simple resolver function
      resolveNodeParameters: (node: WorkflowNode, input: any) => {
        return { ...node.values, ...input };
      },
    };

    console.log("🤖 [AI AGENT ROUTE] Executing AI Agent...");
    const result = await aiAgentExecutor.execute(node, {}, context);

    console.log(
      "🤖 [AI AGENT ROUTE] Execution completed:",
      result.success ? "✅" : "❌"
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error || "AI Agent execution failed",
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error: any) {
    console.error("❌ [AI AGENT ROUTE] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "AI Agent execution failed",
    });
  }
});

export default router;
