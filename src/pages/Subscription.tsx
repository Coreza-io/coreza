/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CreditCard,
  Zap,
  TrendingUp,
  Brain,
  Users,
  Calendar,
  ExternalLink,
  Loader2,
  Check,
  ArrowUpRight,
} from "lucide-react";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const TIER_CONFIG = {
  free: {
    name: "Free",
    icon: Zap,
    color: "bg-muted",
    features: ["100 executions/month", "5 active workflows", "Basic indicators", "1 broker"],
  },
  trader: {
    name: "Trader",
    icon: TrendingUp,
    color: "bg-gradient-indicators",
    features: ["5,000 executions/month", "Unlimited workflows", "All indicators", "2 brokers", "Basic backtesting"],
  },
  professional: {
    name: "Professional",
    icon: Brain,
    color: "bg-gradient-primary",
    features: ["25,000 executions/month", "AI analysis", "Unlimited brokers", "Advanced backtesting", "API access"],
  },
  enterprise: {
    name: "Enterprise",
    icon: Users,
    color: "bg-gradient-broker",
    features: ["Unlimited executions", "Dedicated infrastructure", "Custom integrations", "24/7 support", "SLA"],
  },
};

interface SubscriptionData {
  stripe_customer_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
}

const Subscription = () => {
  const { tier, status, executionCount, executionLimit, isLoading, refreshSubscription } = useSubscription();
  const { user } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null);

  useEffect(() => {
    const fetchSubscriptionData = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("subscriptions")
        .select("stripe_customer_id, current_period_start, current_period_end")
        .eq("user_id", user.id)
        .single();
      if (data) setSubscriptionData(data);
    };
    fetchSubscriptionData();
  }, [user?.id]);

  const tierConfig = TIER_CONFIG[tier];
  const TierIcon = tierConfig.icon;

  const usagePercent = Math.min(100, (executionCount / executionLimit) * 100);
  const isNearLimit = usagePercent >= 80;

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-portal", {
        body: {
          return_url: `${window.location.origin}/dashboard/subscription`,
        },
      });

      if (error) throw error;

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No portal URL returned");
      }
    } catch (error: any) {
      console.error("Billing portal error:", error);
      toast.error(error.message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Subscription</h1>
        <p className="text-muted-foreground mt-1">Manage your plan and billing</p>
      </div>

      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-lg ${tierConfig.color}`}>
                <TierIcon className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2">
                  {tierConfig.name} Plan
                  <Badge variant={status === "active" ? "default" : "secondary"}>
                    {status}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {subscriptionData?.current_period_end
                    ? `Renews ${format(new Date(subscriptionData.current_period_end), "MMMM d, yyyy")}`
                    : "No billing cycle"}
                </CardDescription>
              </div>
            </div>
            {tier !== "free" && subscriptionData?.stripe_customer_id && (
              <Button variant="outline" onClick={handleManageBilling} disabled={portalLoading}>
                {portalLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CreditCard className="h-4 w-4 mr-2" />
                )}
                Manage Billing
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Usage Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Workflow Executions</span>
              <span className={isNearLimit ? "text-destructive font-medium" : ""}>
                {executionCount.toLocaleString()} / {executionLimit.toLocaleString()}
              </span>
            </div>
            <Progress value={usagePercent} className={isNearLimit ? "[&>div]:bg-destructive" : ""} />
            {isNearLimit && (
              <p className="text-xs text-destructive">
                You're approaching your monthly limit. Consider upgrading for more executions.
              </p>
            )}
          </div>

          <Separator />

          {/* Features */}
          <div>
            <h4 className="text-sm font-medium mb-3">Plan Features</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {tierConfig.features.map((feature, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 text-primary flex-shrink-0" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Billing Info */}
          {subscriptionData?.current_period_start && subscriptionData?.current_period_end && (
            <>
              <Separator />
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Billing Period:</span>
                  <span>
                    {format(new Date(subscriptionData.current_period_start), "MMM d")} -{" "}
                    {format(new Date(subscriptionData.current_period_end), "MMM d, yyyy")}
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upgrade CTA for Free/Trader */}
      {(tier === "free" || tier === "trader") && (
        <Card className="border-primary/50 bg-gradient-to-r from-primary/5 to-accent/5">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold text-lg">
                  {tier === "free" ? "Unlock Premium Features" : "Upgrade to Professional"}
                </h3>
                <p className="text-muted-foreground text-sm mt-1">
                  {tier === "free"
                    ? "Get more executions, all indicators, and advanced features."
                    : "Get AI analysis, unlimited brokers, and advanced backtesting."}
                </p>
              </div>
              <Link to="/pricing">
                <Button className="bg-gradient-primary shadow-glow">
                  View Plans
                  <ArrowUpRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => window.open("/pricing", "_blank")}>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="p-2 bg-muted rounded-lg">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Compare Plans</h4>
              <p className="text-sm text-muted-foreground">See all features and pricing</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={() => window.open("/support", "_blank")}>
          <CardContent className="pt-6 flex items-center gap-4">
            <div className="p-2 bg-muted rounded-lg">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h4 className="font-medium">Contact Support</h4>
              <p className="text-sm text-muted-foreground">Get help with billing questions</p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Subscription;
