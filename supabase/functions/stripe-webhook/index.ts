import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

// Map Stripe price IDs to subscription tiers
// Update these with your actual Stripe price IDs after creating products
const PRICE_TO_TIER: Record<string, string> = {
  // Monthly prices
  "price_trader_monthly": "trader",
  "price_professional_monthly": "professional",
  "price_enterprise_monthly": "enterprise",
  // Yearly prices (if applicable)
  "price_trader_yearly": "trader",
  "price_professional_yearly": "professional",
  "price_enterprise_yearly": "enterprise",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
      console.error("Missing required environment variables");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the raw body and signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("No Stripe signature found");
      return new Response(JSON.stringify({ error: "No signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err instanceof Error ? err.message : err);
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Processing Stripe event: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("Checkout session completed:", session.id);

        if (session.mode === "subscription" && session.subscription) {
          // Get the subscription details
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const priceId = subscription.items.data[0]?.price.id;
          const tier = PRICE_TO_TIER[priceId] || "trader";
          const userId = session.client_reference_id; // Set this when creating checkout session

          if (!userId) {
            console.error("No user ID in checkout session");
            break;
          }

          // Update subscription in database
          const { error } = await supabase
            .from("subscriptions")
            .update({
              tier: tier,
              status: "active",
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: subscription.id,
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);

          if (error) {
            console.error("Error updating subscription:", error);
          } else {
            console.log(`Subscription updated for user ${userId} to tier ${tier}`);
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription updated:", subscription.id);

        const priceId = subscription.items.data[0]?.price.id;
        const tier = PRICE_TO_TIER[priceId] || "trader";
        const status = subscription.status === "active" ? "active" : 
                       subscription.status === "past_due" ? "active" : // Keep active but flag
                       subscription.status === "canceled" ? "cancelled" :
                       subscription.status === "trialing" ? "trial" : "active";

        const { error } = await supabase
          .from("subscriptions")
          .update({
            tier: tier,
            status: status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) {
          console.error("Error updating subscription:", error);
        } else {
          console.log(`Subscription ${subscription.id} updated to tier ${tier}, status ${status}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("Subscription deleted:", subscription.id);

        // Downgrade to free tier
        const { error } = await supabase
          .from("subscriptions")
          .update({
            tier: "free",
            status: "cancelled",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id);

        if (error) {
          console.error("Error downgrading subscription:", error);
        } else {
          console.log(`Subscription ${subscription.id} downgraded to free`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Invoice payment failed:", invoice.id);

        if (invoice.subscription) {
          // Could set status to 'past_due' or send notification
          // For now, just log it
          console.log(`Payment failed for subscription ${invoice.subscription}`);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("Invoice payment succeeded:", invoice.id);

        if (invoice.subscription) {
          // Ensure subscription is marked as active
          const { error } = await supabase
            .from("subscriptions")
            .update({
              status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_subscription_id", invoice.subscription);

          if (error) {
            console.error("Error updating subscription status:", error);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: "Webhook handler failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
