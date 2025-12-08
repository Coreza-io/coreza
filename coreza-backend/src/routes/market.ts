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
import { DataService } from '../services/data';

const router = express.Router();

// Get candle data from Yahoo Finance
router.post('/get-candle', async (req, res) => {
  try {
    const { ticker, interval = '1d', lookback = 100 } = req.body;

    if (!ticker) {
      return res.status(400).json({ error: 'Ticker symbol is required' });
    }

    const result = await DataService.execute('market', 'get_candle', {
      ticker,
      interval,
      lookback
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 500).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    console.error('Market data API error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch market data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;