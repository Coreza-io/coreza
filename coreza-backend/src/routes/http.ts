/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import express from 'express';
import { HttpService } from '../nodes/logic/http';
import { requireAuth } from '../middleware/jwtAuth';

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// HTTP Request handler
router.post('/request', async (req, res) => {
  try {
    const result = await HttpService.execute(req.body);

    if (result.success) {
      res.json({
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        data: result.data
      });
    } else {
      res.status(result.status || 500).json({
        error: 'HTTP request failed',
        status: result.status,
        statusText: result.statusText,
        data: result.data,
        message: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to make HTTP request',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;