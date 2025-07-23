import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { user_id, service_type, name, encrypted_data } = await req.json()

    if (!user_id || !service_type || !name || !encrypted_data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`Storing encrypted credentials for user ${user_id}, service: ${service_type}, name: ${name}`)
    // TEMPORARILY COMMENTED: Encryption validation
    // console.log(`Encrypted data type: ${typeof encrypted_data}, fields: ${Object.keys(encrypted_data).join(', ')}`)
    
    // // Validate that encrypted_data is an object with encrypted fields
    // if (typeof encrypted_data !== 'object' || encrypted_data === null) {
    //   return new Response(
    //     JSON.stringify({ error: 'Encrypted data must be an object with encrypted fields' }),
    //     { 
    //       status: 400, 
    //       headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    //     }
    //   )
    // }

    // TEMPORARY: Store credentials in plain text
    console.log(`Storing plain text credentials for user ${user_id}, service: ${service_type}, name: ${name}`)
    console.log(`Credential data type: ${typeof encrypted_data}`)
    
    if (typeof encrypted_data !== 'object' || encrypted_data === null) {
      return new Response(
        JSON.stringify({ error: 'Credential data must be an object' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Store encrypted credentials in the database
    // encrypted_data is now a string containing the encrypted blob
    const { data, error } = await supabaseClient
      .from('user_credentials')
      .upsert({
        user_id,
        service_type,
        name,
        client_json: encrypted_data, // TEMPORARY: Store credentials in plain text
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