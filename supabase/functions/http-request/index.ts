
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface HttpRequestPayload {
  method: string;
  url: string;
  auth_type?: string;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
  api_key_location?: string;
  api_key_name?: string;
  api_key_value?: string;
  headers?: Array<{ name: string; value: string }>;
  body_type?: string;
  json_body?: string;
  form_data?: Array<{ name: string; value: string }>;
  raw_body?: string;
  timeout?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: HttpRequestPayload = await req.json();
    
    // Validate required fields
    if (!payload.url || !payload.method) {
      throw new Error("URL and method are required");
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(payload.url);
    } catch {
      throw new Error("Invalid URL format");
    }

    // Security check: prevent requests to private networks
    if (url.hostname === "localhost" || 
        url.hostname.startsWith("127.") || 
        url.hostname.startsWith("192.168.") || 
        url.hostname.startsWith("10.") ||
        url.hostname.includes("internal")) {
      throw new Error("Requests to private networks are not allowed");
    }

    // Prepare headers
    const headers = new Headers();
    headers.set("User-Agent", "Coreza-HTTP-Node/1.0");

    // Add authentication
    if (payload.auth_type === "bearer" && payload.bearer_token) {
      headers.set("Authorization", `Bearer ${payload.bearer_token}`);
    } else if (payload.auth_type === "basic" && payload.basic_username && payload.basic_password) {
      const credentials = btoa(`${payload.basic_username}:${payload.basic_password}`);
      headers.set("Authorization", `Basic ${credentials}`);
    } else if (payload.auth_type === "api_key" && payload.api_key_name && payload.api_key_value) {
      if (payload.api_key_location === "header") {
        headers.set(payload.api_key_name, payload.api_key_value);
      } else if (payload.api_key_location === "query") {
        url.searchParams.set(payload.api_key_name, payload.api_key_value);
      }
    }

    // Add custom headers
    if (payload.headers && Array.isArray(payload.headers)) {
      payload.headers.forEach(header => {
        if (header.name && header.value) {
          headers.set(header.name, header.value);
        }
      });
    }

    // Prepare body
    let body: string | FormData | undefined;
    if (payload.method !== "GET" && payload.method !== "HEAD") {
      if (payload.body_type === "json" && payload.json_body) {
        headers.set("Content-Type", "application/json");
        body = payload.json_body;
      } else if (payload.body_type === "form" && payload.form_data) {
        const formData = new FormData();
        payload.form_data.forEach(item => {
          if (item.name && item.value) {
            formData.append(item.name, item.value);
          }
        });
        body = formData;
      } else if (payload.body_type === "raw" && payload.raw_body) {
        headers.set("Content-Type", "text/plain");
        body = payload.raw_body;
      }
    }

    // Set timeout (default 30 seconds, max 60 seconds)
    const timeoutMs = Math.min(parseInt(payload.timeout || "30") * 1000, 60000);
    
    // Make the HTTP request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: payload.method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Get response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Get response body
      let responseBody: any;
      const contentType = response.headers.get("content-type") || "";
      
      if (contentType.includes("application/json")) {
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }
      } else {
        responseBody = await response.text();
      }

      const result = {
        success: true,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: responseBody,
        url: url.toString(),
        method: payload.method,
      };

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });

    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${timeoutMs / 1000} seconds`);
      }
      throw error;
    }

  } catch (error: any) {
    console.error("HTTP Request Error:", error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "An unknown error occurred",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
};

serve(handler);
