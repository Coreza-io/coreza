import express from 'express';
import { HttpService } from '../services/http';

const router = express.Router();

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