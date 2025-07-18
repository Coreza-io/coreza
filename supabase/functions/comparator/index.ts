import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SwitchRequest {
  inputValue: string;
  cases: Array<{
    caseValue: string;
    caseName: string;
  }>;
  defaultCase?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/comparator/switch' && req.method === 'POST') {
      const body: SwitchRequest = await req.json();
      console.log('Switch request:', body);

      const { inputValue, cases, defaultCase = "default" } = body;

      if (!inputValue || !cases || !Array.isArray(cases)) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: inputValue and cases array' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // Find matching case
      for (const caseItem of cases) {
        if (caseItem.caseValue === inputValue) {
          console.log(`Match found: ${inputValue} -> ${caseItem.caseName}`);
          return new Response(
            JSON.stringify([{ result: caseItem.caseName }]),
            { 
              status: 200, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }
      }

      // No match found - return default case
      console.log(`No match found for ${inputValue}, using default case: ${defaultCase}`);
      return new Response(
        JSON.stringify([{ result: defaultCase }]),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Path not found
    return new Response(
      JSON.stringify({ error: 'Endpoint not found' }),
      { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error processing switch request:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
})