import express from 'express';
import axios from 'axios';
import { supabase } from '../config/supabase';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// FinnHub API Configuration
const BASE_URL = 'https://finnhub.io/api/v1';

interface FinnHubCredentials {
  api_key: string;
}

// Helper function to get API credentials
async function getApiCredentials(userId: string, credentialId: string): Promise<FinnHubCredentials> {
  try {
    const { data, error } = await supabase
      .from('user_credentials')
      .select('client_json')
      .eq('user_id', userId)
      .eq('name', credentialId)
      .eq('service_type', 'finnhub')
      .single();

    if (error || !data) {
      throw createError('FinnHub credentials not found', 404);
    }

    const creds = data.client_json;
    if (!creds.api_key) {
      throw createError('Invalid FinnHub API credentials', 400);
    }

    return {
      api_key: creds.api_key
    };
  } catch (error) {
    throw createError('Failed to retrieve FinnHub credentials', 500);
  }
}

// Get user credentials list for FinnHub
router.get('/credentials', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    
    const { data, error } = await supabase
      .from('user_credentials')
      .select('id, name, service_type, created_at')
      .eq('user_id', user_id)
      .eq('service_type', 'finnhub');
      
    if (error) {
      console.error('Error fetching credentials:', error);
      return res.status(500).json({ error: 'Failed to fetch credentials' });
    }
    
    res.json({
      success: true,
      credentials: data || []
    });
  } catch (error) {
    next(error);
  }
});

// Save and validate credentials (authAction)
router.post('/auth-url', async (req, res, next) => {
  try {
    const { user_id, credential_name, api_key } = req.body;
    
    if (!user_id || !credential_name || !api_key) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Test the credentials by making a test API call
    try {
      const testResponse = await axios.get(`${BASE_URL}/quote`, {
        params: {
          symbol: 'AAPL',
          token: api_key
        },
        timeout: 10000
      });
      
      if (testResponse.status !== 200 || !testResponse.data.c) {
        return res.status(401).json({ error: 'Invalid FinnHub API key' });
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        return res.status(401).json({ error: 'Invalid FinnHub API key' });
      }
      return res.status(502).json({ error: 'Failed to validate FinnHub credentials' });
    }

    // Save credentials to database
    const { data, error } = await supabase
      .from('user_credentials')
      .upsert({
        user_id,
        name: credential_name,
        service_type: 'finnhub',
        client_json: { api_key }
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to save credentials' });
    }

    res.json({
      success: true,
      message: 'FinnHub credentials saved successfully',
      credential_id: data.id
    });
  } catch (error) {
    next(error);
  }
});

// Get quote data (main action)
router.post('/get-quote', async (req, res, next) => {
  try {
    const { user_id, credential_id, ticker } = req.body;
    
    if (!user_id || !credential_id || !ticker) {
      return res.status(400).json({ error: 'user_id, credential_id, and ticker are required' });
    }

    const creds = await getApiCredentials(user_id, credential_id);
    
    const response = await axios.get(`${BASE_URL}/quote`, {
      params: {
        symbol: ticker.toUpperCase(),
        token: creds.api_key
      },
      timeout: 10000
    });
    
    res.json({
      symbol: ticker.toUpperCase(),
      data: response.data
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status).json({ error: `FinnHub API error: ${error.response.data}` });
    }
    next(error);
  }
});

export default router;