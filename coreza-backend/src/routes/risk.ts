import express from 'express';
import { RiskEngineService } from '../services/risk';

const router = express.Router();

router.post('/engine', async (req, res) => {
  try {
    const result = RiskEngineService.evaluate(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result.data);
  } catch (error) {
    console.error('Risk engine error:', error);
    res.status(500).json({
      error: 'Failed to evaluate risk engine',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
