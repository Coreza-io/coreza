import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import workflowRoutes from './routes/workflow';
import yahoofinanceRoutes from './routes/yahoofinance';
import httpRoutes from './routes/http';
import schedulerRoutes from './routes/scheduler';
import comparatorRoutes from './routes/comparator';
import WebSocketManager from './services/websocketManager';


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
app.use('/indicators', indicatorRoutes);
app.use('/alpaca', alpacaRoutes);
app.use('/market', marketRoutes);
app.use('/credentials', credentialsRoutes);
app.use('/dhan', dhanRoutes);
app.use('/gmail', gmailRoutes);
app.use('/whatsapp', whatsappRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/workflows', workflowRoutes);
app.use('/yahoofinance', yahoofinanceRoutes);
app.use('/http', httpRoutes);
app.use('/execute', schedulerRoutes);
app.use('/comparator', comparatorRoutes);

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
    WebSocketManager.initialize(8081);

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