import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the encryption key from environment
    const encryptionKey = Deno.env.get('COREZA_ENCRYPTION_KEY');
    
    if (!encryptionKey) {
      console.error('COREZA_ENCRYPTION_KEY not found in environment');
      return new Response(
        JSON.stringify({ error: 'Encryption key not configured' }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ key: encryptionKey }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error getting encryption key:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get encryption key' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
})