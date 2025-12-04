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
import { getScreenerService } from '../services/screeners/registry';

const router = express.Router();

// Generic screener endpoint - dynamic operation
router.post('/:screener/:operation', async (req, res) => {
  try {
    const { screener, operation } = req.params;
    const { user_id, credential_id, ...params } = req.body;

    console.log(`📊 [SCREENER-ROUTE] ${screener}/${operation} request:`, { user_id, credential_id, params });

    if (!user_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'user_id is required' 
      });
    }

    const screenerService = getScreenerService(screener);
    if (!screenerService) {
      return res.status(400).json({
        success: false,
        error: `Unsupported screener: ${screener}`
      });
    }

    const result = await screenerService.execute({
      user_id,
      credential_id,
      operation,
      ...params
    });

    console.log(`📊 [SCREENER-ROUTE] ${screener}/${operation} result:`, result);
    res.json(result);
  } catch (error: any) {
    console.error('[SCREENER-ROUTE] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error'
    });
  }
});

// Get user's screener credentials
router.get('/:screener/credentials', async (req, res) => {
  try {
    const { screener } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { BrokerService } = await import('../services/brokers');
    const credentials = await BrokerService.getCredentialsList(
      screener,
      user_id as string
    );

    res.json(credentials);
  } catch (error: any) {
    console.error('[SCREENER-ROUTE] Credentials error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
