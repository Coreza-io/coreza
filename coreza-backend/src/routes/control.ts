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
import { requireAuth } from '../middleware/jwtAuth';

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Loop configuration helper
function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split('.').reduce((acc: any, key: string) => (acc ? acc[key] : undefined), obj);
}

router.post('/loop', (req, res) => {
  try {
    const {
      inputArray,
      batchSize = 1,
      items,
      parallel = false,
      continueOnError = false,
      throttleMs = 200,
    } = req.body;
    
    // Get the array to loop over
    let arrayData: any[] = [];
    if (inputArray && req.body[inputArray]) {
      arrayData = Array.isArray(req.body[inputArray]) ? req.body[inputArray] : [req.body[inputArray]];
    } else if (Array.isArray(items)) {
      arrayData = items;
    }

    console.log(`🔄 Loop processing ${arrayData.length} items with batch size ${batchSize}`);

    res.json({
      items: arrayData,
      batchSize,
      totalItems: arrayData.length,
      parallel,
      continueOnError,
      throttleMs,
      isLoopNode: true,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process loop data' });
  }
});

export default router;
