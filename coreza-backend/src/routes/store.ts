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
import { requireAuth } from "../middleware/jwtAuth";
import { getRedisCache } from "../config/redis";
import { supabase } from "../config/supabase";
import logger from "../utils/logger";
import {
  buildStoreKey,
  extractVariableNameFromKey,
  getStoreValue,
} from "../utils/store";
import { DataSourceExecutor } from "../nodes/executors/DataSourceExecutor";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// GET /store/workflows - List workflows for the authenticated user
router.get("/workflows", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("workflows")
      .select("id, name")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      workflows:
        data?.map((workflow) => ({ id: workflow.id, name: workflow.name })) ??
        [],
    });
  } catch (error) {
    logger.error({ err: error }, "Error listing workflows");
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

// GET /store/variables - List stored variable names for a workflow
router.get("/variables", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflow_id } = req.query;

    if (!workflow_id) {
      return res
        .status(400)
        .json({ error: "workflow_id is required" });
    }

    const redis = getRedisCache();
    const pattern = buildStoreKey(
      userId,
      workflow_id as string,
      "*"
    );
    const keys = await redis.keys(pattern);

    res.json({
      success: true,
      variables: keys.map(extractVariableNameFromKey),
    });
  } catch (error) {
    logger.error({ err: error }, "Error listing variables");
    res.status(500).json({ error: "Failed to list variables" });
  }
});

// GET /store/value - Retrieve a value from another workflow
router.get("/value", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflow_id, variable_name } = req.query;

    if (!workflow_id || !variable_name) {
      return res
        .status(400)
        .json({ error: "workflow_id and variable_name required" });
    }

    const redis = getRedisCache();
    const key = buildStoreKey(
      userId,
      workflow_id as string,
      variable_name as string
    );
    const storedValue = await getStoreValue(redis, key);

    res.json({
      success: true,
      value: storedValue,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching store value");
    res.status(500).json({ error: "Failed to fetch value" });
  }
});

// POST /store/execute - Execute comprehensive store operations (delegates to DataSourceExecutor)
router.post("/execute", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const executor = new DataSourceExecutor();
    const result = await executor.executeStoreNode(req.body, { userId });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Error executing store operation");
    res.status(500).json({ error: "Failed to execute store operation" });
  }
});

export default router;
