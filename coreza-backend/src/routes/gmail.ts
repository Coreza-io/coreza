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
import { CommunicationService } from "../services/communications";
import { requireAuth } from "../middleware/jwtAuth";

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Get user credentials list for Gmail
router.get("/credentials", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from query params
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await CommunicationService.execute(
      "gmail",
      "list_credentials",
      { user_id }
    );

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      credentials: result.data || [],
    });
  } catch (error) {
    next(error);
  }
});

// Send email
router.post("/send", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_id, to, subject, body, html } = req.body;

    const result = await CommunicationService.execute("gmail", "send_email", {
      user_id,
      credential_id,
      to,
      subject,
      body,
      html,
    });

    if (!result.success) {
      return res
        .status(result.error?.includes("authentication") ? 401 : 400)
        .json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get emails
router.post("/messages", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_id, query, max_results } = req.body;

    const result = await CommunicationService.execute("gmail", "get_messages", {
      user_id,
      credential_id,
      query,
      maxResults: max_results,
    });

    if (!result.success) {
      return res
        .status(result.error?.includes("authentication") ? 401 : 400)
        .json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get specific email content
router.post("/message/:messageId", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { messageId } = req.params;
    const { credential_id } = req.body;

    const result = await CommunicationService.execute("gmail", "get_message", {
      user_id,
      credential_id,
      messageId,
    });

    if (!result.success) {
      return res
        .status(result.error?.includes("authentication") ? 401 : 400)
        .json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
