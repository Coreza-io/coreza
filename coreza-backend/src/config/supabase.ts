/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import * as dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Alpaca Configuration - Paper Trading URLs (Public)
export const ALPACA_CONFIG = {
  PAPER_URL: 'https://paper-api.alpaca.markets',
  DATA_URL: 'https://data.alpaca.markets',
  // API keys will be loaded from Supabase secrets
};

export default supabase;