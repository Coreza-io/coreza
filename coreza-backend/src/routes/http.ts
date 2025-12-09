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

import express from 'express';
import { HttpService } from '../services/http';
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