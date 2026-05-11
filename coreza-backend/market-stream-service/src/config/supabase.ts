import * as dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_SERVICE_ROLE_KEY is deprecated. Please migrate to SUPABASE_SECRET_KEY.");
}

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SECRET_KEY (SUPABASE_SERVICE_ROLE_KEY is deprecated fallback).');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
}) as SupabaseClient<any>;

// Alpaca Configuration - Paper Trading URLs (Public)
export const ALPACA_CONFIG = {
  PAPER_URL: 'https://paper-api.alpaca.markets',
  DATA_URL: 'https://data.alpaca.markets',
  // API keys will be loaded from Supabase secrets
};

export default supabase;