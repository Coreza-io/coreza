import express from 'express';
import { BrokerService } from '../services/brokers';

const router = express.Router();

// Dynamic operation endpoint for AlpacaStream node
router.post('/:operation', async (req, res, next) => {
  try {
    const { operation } = req.params;
    const { user_id, credential_id } = req.body;

    if (!user_id || !credential_id) {
      return res.status(400).json({ error: 'user_id and credential_id are required' });
    }

    const result = await BrokerService.execute('alpacastream', {
      user_id,
      credential_id,
      operation,
      ...req.body,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    console.error('AlpacaStream operation error:', error);
    next(error);
  }
});

export default router;
