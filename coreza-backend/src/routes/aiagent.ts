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

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { AIAgentExecutor } from "../nodes/executors/AIAgentExecutor";
import { WorkflowNode } from "../nodes/types";

const router = Router();
const aiAgentExecutor = new AIAgentExecutor();

// Apply JWT auth to all routes
router.use(requireAuth);

router.post("/execute", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      node_id,
      nodeName,
      node_type,
      category,
      systemPrompt,
      userPrompt,
      temperature,
      maxIterations,
      returnIntermediateSteps,
      support_nodes: workflowNodes,
      edges: workflowEdges,
      workflowId,
    } = req.body;

    console.log("🤖 [AI AGENT ROUTE] Received execution request");
    console.log("🤖 [AI AGENT ROUTE] User ID:", userId);
    console.log("🤖 [AI AGENT ROUTE] Nodes count:", workflowNodes?.length || 0);
    console.log("🤖 [AI AGENT ROUTE] Edges count:", workflowEdges?.length || 0);

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

    // Use the node from request and merge with execution values
    const node: WorkflowNode = {
      id: node_id,
      name: nodeName,
      node_type: node_type,
      category: category,
      values: {
        systemPrompt,
        userPrompt,
        temperature,
        maxIterations,
        returnIntermediateSteps,
      },
    };

    // Create execution context with all necessary data
    const context = {
      userId,
      nodes: workflowNodes,
      edges: workflowEdges,
      workflowId,
      executionId: req.body.workflowSessionId || workflowId,
      // Add a simple resolver function
      resolveNodeParameters: (node: WorkflowNode, input: any) => {
        return { ...node.values, ...input };
      },
    };

    console.log("🤖 [AI AGENT ROUTE] Executing AI Agent...");
    const result = await aiAgentExecutor.execute(node, {}, context);

    console.log(
      "🤖 [AI AGENT ROUTE] Execution completed:",
      result.success ? "✅" : "❌",
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
