// Force UTC timezone for all date operations in Node.js
process.env.TZ = 'UTC';

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
import marketRoutes from './routes/market';
import credentialsRoutes from './routes/credentials';
import gmailRoutes from './routes/gmail';
import finnhubRoutes from './routes/finnhub';
import whatsappRoutes from './routes/whatsapp';
import webhookRoutes from './routes/webhooks';
import workflowRoutes from './routes/workflow';
import yahoofinanceRoutes from './routes/yahoofinance';
import httpRoutes from './routes/http';
import schedulerRoutes from './routes/scheduler';
import comparatorRoutes from './routes/comparator';
import riskRoutes from './routes/risk';
import controlRoutes from './routes/control';
import websocketRoutes from './routes/websocket';
import openaiRoutes from './routes/openai';
import aiAgentRoutes from './routes/aiagent';
import googleSearchRoutes from './routes/googlesearch';
import screenerRoutes from './routes/screener';
import brokerRoutes from './routes/broker';

import WebSocketManager from './services/websocketManager';
import { initializeNodeExecutors } from './nodes';
import { initializeScreenerServices } from './services/screeners';


const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Store supabase instance in app.locals for route access
app.locals.supabase = supabase;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Routes - with debugging
console.log('📍 Setting up routes...');
app.use('/indicators', indicatorRoutes);
console.log('✅ Indicators route mounted');
app.use('/market', marketRoutes);
console.log('✅ Market route mounted');
app.use('/credentials', credentialsRoutes);
console.log('✅ Credentials route mounted');
app.use('/gmail', gmailRoutes);
console.log('✅ Gmail route mounted');
app.use('/finnhub', finnhubRoutes);
console.log('✅ FinnHub route mounted');
app.use('/whatsapp', whatsappRoutes);
console.log('✅ WhatsApp route mounted');
app.use('/webhooks', webhookRoutes);
console.log('✅ Webhooks route mounted');
app.use('/workflows', workflowRoutes);
console.log('✅ Workflows route mounted');
app.use('/yahoofinance', yahoofinanceRoutes);
console.log('✅ YahooFinance route mounted');
app.use('/http', httpRoutes);
console.log('✅ HTTP route mounted');
app.use('/execute', schedulerRoutes);
console.log('✅ Execute/Scheduler route mounted');
app.use('/comparator', comparatorRoutes);
console.log('✅ Comparator route mounted');
app.use('/control', controlRoutes);
console.log('✅ Control route mounted');
app.use('/risk', riskRoutes);
console.log('✅ Risk route mounted');
app.use('/websocket', websocketRoutes);
console.log('✅ WebSocket route mounted');
app.use('/openai', openaiRoutes);
console.log('✅ OpenAI route mounted');
app.use('/aiagent', aiAgentRoutes);
console.log('✅ AI Agent route mounted');
app.use('/googlesearch', googleSearchRoutes);
console.log('✅ Google Search route mounted');
app.use('/screener', screenerRoutes);
console.log('✅ Screener route mounted');
app.use('/broker', brokerRoutes);
console.log('✅ Broker route mounted');
console.log('📍 All routes mounted successfully');

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

    // Initialize node executors and screener services
    initializeScreenerServices();
    initializeNodeExecutors();

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