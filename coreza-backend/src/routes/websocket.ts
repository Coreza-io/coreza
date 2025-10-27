import express from 'express';
import WebSocketManager from '../services/websocketManager';

const router = express.Router();

// WebSocket status endpoint for debugging
router.get('/status', (req, res) => {
  try {
    const stats = WebSocketManager.getStats();
    res.json({
      success: true,
      websocket: {
        running: true,
        port: process.env.WEBSOCKET_PORT || 8081,
        ...stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'WebSocket status error'
    });
  }
});

// Send message to user endpoint (for testing)
router.post('/send/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Message type is required' });
    }

    WebSocketManager.sendToUser(userId, { type, payload });
    
    res.json({
      success: true,
      message: `Message sent to user ${userId}`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Send message error'
    });
  }
});

// Broadcast message endpoint (for testing)
router.post('/broadcast', (req, res) => {
  try {
    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Message type is required' });
    }

    WebSocketManager.broadcast({ type, payload });
    
    res.json({
      success: true,
      message: 'Message broadcasted to all clients'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Broadcast error'
    });
  }
});

export default router;