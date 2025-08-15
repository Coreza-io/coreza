import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Security-focused key derivation function
async function deriveUserKey(masterKey: string, userId: string, context: string): Promise<string> {
  const encoder = new TextEncoder();
  
  // COREZA_ENCRYPTION_KEY is base64-encoded
  const keyBytes = Uint8Array.from(atob(masterKey), c => c.charCodeAt(0));

  // Import master key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  
  // Derive user-specific key using HKDF
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`coreza-salt-${userId}`),
      info: encoder.encode(`coreza-${context}-v1`)
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  
  // Export as raw bytes and return as base64
  const exported = await crypto.subtle.exportKey('raw', derivedKey);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify user authentication
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Create Supabase client to verify JWT
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get the master encryption key from environment
    const masterKey = Deno.env.get('COREZA_ENCRYPTION_KEY');
    if (!masterKey) {
      console.error('COREZA_ENCRYPTION_KEY not found in environment');
      return new Response(
        JSON.stringify({ error: 'Encryption key not configured' }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Derive user-specific key
    const userKey = await deriveUserKey(masterKey, user.id, 'credentials');

    // Log access for security monitoring (without exposing key)
    console.log(`🔑 User-specific encryption key derived for user: ${user.id}`)

    return new Response(
      JSON.stringify({ key: userKey }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error deriving encryption key:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to derive encryption key' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
})