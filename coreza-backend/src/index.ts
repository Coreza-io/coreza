import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { workflowScheduler } from './services/scheduler';

// Import routes
import indicatorRoutes from './routes/indicators';
import alpacaRoutes from './routes/alpaca';
import marketRoutes from './routes/market';
import credentialsRoutes from './routes/credentials';
import dhanRoutes from './routes/dhan';
import gmailRoutes from './routes/gmail';
import whatsappRoutes from './routes/whatsapp';
import webhookRoutes from './routes/webhooks';
import WebSocketManager from './services/websocketManager';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Routes
app.use('/api/indicators', indicatorRoutes);
app.use('/api/alpaca', alpacaRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/credentials', credentialsRoutes);
app.use('/api/dhan', dhanRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/webhooks', webhookRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    // Test Supabase connection
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) {
      console.warn('Supabase connection warning:', error.message);
    } else {
      console.log('✅ Supabase connected successfully');
    }

    // Initialize workflow scheduler
    await workflowScheduler.initialize();

    // Initialize WebSocket server
    WebSocketManager.initialize(8080);

    app.listen(PORT, () => {
      console.log(`🚀 Coreza Node.js Backend running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();