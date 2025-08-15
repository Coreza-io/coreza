import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

class EncryptionUtil {
  private static readonly ALGORITHM = 'AES-GCM';

  private static async importKey(keyString: string): Promise<CryptoKey> {
    const keyBuffer = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
    
    return await webcrypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: this.ALGORITHM },
      false,
      ['encrypt']
    );
  }

  static async encrypt(data: string): Promise<string> {
    try {
      const encryptionKey = Deno.env.get('COREZA_ENCRYPTION_KEY');
      if (!encryptionKey) {
        throw new Error('COREZA_ENCRYPTION_KEY not found');
      }

      const key = await this.importKey(encryptionKey);
      const encoder = new TextEncoder();
      const iv = webcrypto.getRandomValues(new Uint8Array(12));

      const encrypted = await webcrypto.subtle.encrypt(
        { name: this.ALGORITHM, iv: iv },
        key,
        encoder.encode(data)
      );

      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      return btoa(String.fromCharCode.apply(null, Array.from(combined)));
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { user_id, service_type, name, credentials } = await req.json()

    if (!user_id || !service_type || !name || !credentials) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Encrypting and storing credentials for user ${user_id}, service: ${service_type}, name: ${name}`)
    
    // Encrypt credentials before storing
    const encryptedCredentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(credentials as Record<string, string>)) {
      encryptedCredentials[key] = await EncryptionUtil.encrypt(value);
    }

    // Store encrypted credentials in the database
    const { data, error } = await supabaseClient
      .from('user_credentials')
      .upsert({
        user_id,
        service_type,
        name,
        client_json: encryptedCredentials,
        token_json: {},
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,service_type,name'
      })

    if (error) {
      console.error('Database error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to store credentials' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('Credentials stored successfully for user:', user_id)

    return new Response(
      JSON.stringify({ success: true, message: 'Credentials stored successfully' }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error storing credentials:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})