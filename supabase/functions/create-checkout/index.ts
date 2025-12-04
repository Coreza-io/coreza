import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map tiers to Stripe price IDs - UPDATE THESE with your actual Stripe price IDs
const TIER_TO_PRICE: Record<string, string> = {
  trader: Deno.env.get("STRIPE_PRICE_TRADER") || "price_trader_monthly",
  professional: Deno.env.get("STRIPE_PRICE_PROFESSIONAL") || "price_professional_monthly",
  enterprise: Deno.env.get("STRIPE_PRICE_ENTERPRISE") || "price_enterprise_monthly",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!stripeSecretKey || !supabaseUrl || !supabaseAnonKey) {
      console.error("Missing required environment variables");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { tier, success_url, cancel_url } = await req.json();

    if (!tier || !TIER_TO_PRICE[tier]) {
      return new Response(JSON.stringify({ error: "Invalid tier. Must be: trader, professional, or enterprise" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Check if user already has a Stripe customer ID
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    let customerId = subscription?.stripe_customer_id;

    // Create or retrieve Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;
      console.log(`Created new Stripe customer: ${customerId}`);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: user.id, // Used by webhook to identify user
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: TIER_TO_PRICE[tier],
          quantity: 1,
        },
      ],
      success_url: success_url || `${req.headers.get("origin")}/dashboard?checkout=success`,
      cancel_url: cancel_url || `${req.headers.get("origin")}/pricing?checkout=cancelled`,
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          tier: tier,
        },
      },
      allow_promotion_codes: true,
    });

    console.log(`Created checkout session ${session.id} for user ${user.id}, tier ${tier}`);

    return new Response(JSON.stringify({ 
      url: session.url,
      session_id: session.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Checkout error:", error);
    return new Response(JSON.stringify({ error: error.message || "Failed to create checkout session" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
