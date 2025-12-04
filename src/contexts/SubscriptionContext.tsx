/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export type SubscriptionTier = "free" | "trader" | "professional" | "enterprise";
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "trial";

export interface SubscriptionContextType {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  features: string[];
  executionCount: number;
  executionLimit: number;
  canUse: (feature: string) => boolean;
  isTrialing: boolean;
  daysRemaining: number | null;
  isLoading: boolean;
  refreshSubscription: () => Promise<void>;
}

const tierOrder: SubscriptionTier[] = ["free", "trader", "professional", "enterprise"];

const tierConfig: Record<SubscriptionTier, { features: string[]; executionLimit: number }> = {
  free: {
    features: [
      "category:Input",
      "category:Indicators",
      "category:Visualization",
      "category:Logic",
      "category:Scheduler",
      "category:Data",
    ],
    executionLimit: 100,
  },
  trader: {
    features: [
      "category:Input",
      "category:Indicators",
      "category:Visualization",
      "category:Logic",
      "category:Scheduler",
      "category:Data",
      "category:Broker",
      "category:Communication",
      "category:Tool",
      "category:Trigger",
    ],
    executionLimit: 5000,
  },
  professional: {
    features: [
      "category:Input",
      "category:Indicators",
      "category:Visualization",
      "category:Logic",
      "category:Scheduler",
      "category:Data",
      "category:Broker",
      "category:Communication",
      "category:Tool",
      "category:Trigger",
      "category:LLM",
      "category:ChatModel",
      "category:AIAgent",
      "category:Risk Management",
      "category:Screener",
    ],
    executionLimit: 25000,
  },
  enterprise: {
    features: [
      "category:Input",
      "category:Indicators",
      "category:Visualization",
      "category:Logic",
      "category:Scheduler",
      "category:Data",
      "category:Broker",
      "category:Communication",
      "category:Tool",
      "category:Trigger",
      "category:LLM",
      "category:ChatModel",
      "category:AIAgent",
      "category:Risk Management",
      "category:Screener",
      "category:webhook",
    ],
    executionLimit: 100000,
  },
};

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return context;
};

export const SubscriptionProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [status, setStatus] = useState<SubscriptionStatus>("active");
  const [executionCount, setExecutionCount] = useState(0);
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSubscription = useCallback(async () => {
    if (!user?.id) {
      setTier("free");
      setStatus("active");
      setExecutionCount(0);
      setPeriodEnd(null);
      setIsLoading(false);
      return;
    }

    try {
      // Fetch subscription data
      const { data: subscription } = await supabase
        .from("subscriptions")
        .select("tier, status, current_period_end")
        .eq("user_id", user.id)
        .maybeSingle();

      if (subscription) {
        setTier(subscription.tier as SubscriptionTier);
        setStatus(subscription.status as SubscriptionStatus);
        setPeriodEnd(subscription.current_period_end ? new Date(subscription.current_period_end) : null);
      } else {
        // No subscription found, default to free
        setTier("free");
        setStatus("active");
        setPeriodEnd(null);
      }

      // Fetch usage data using RPC function
      const { data: usage } = await supabase.rpc("get_current_usage", { p_user_id: user.id });

      if (usage && usage.length > 0) {
        setExecutionCount(usage[0].execution_count || 0);
      } else {
        setExecutionCount(0);
      }
    } catch (error) {
      console.error("Error fetching subscription:", error);
      // Default to free on error
      setTier("free");
      setStatus("active");
      setExecutionCount(0);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Initial fetch and refetch when user changes
  useEffect(() => {
    fetchSubscription();
  }, [fetchSubscription]);

  // Subscribe to real-time updates for subscription changes
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("subscription-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchSubscription();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchSubscription]);

  const features = useMemo(() => tierConfig[tier].features, [tier]);
  const executionLimit = tierConfig[tier].executionLimit;
  const isTrialing = status === "trial";

  const daysRemaining = useMemo(() => {
    if (!periodEnd) return null;
    const diff = periodEnd.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [periodEnd]);

  const canUse = useCallback(
    (feature: string) => {
      if (feature.startsWith("tier:")) {
        const requiredTier = feature.replace("tier:", "") as SubscriptionTier;
        return tierOrder.indexOf(tier) >= tierOrder.indexOf(requiredTier);
      }
      return features.includes(feature);
    },
    [features, tier]
  );

  const value = useMemo(
    () => ({
      tier,
      status,
      features,
      executionCount,
      executionLimit,
      canUse,
      isTrialing,
      daysRemaining,
      isLoading,
      refreshSubscription: fetchSubscription,
    }),
    [canUse, daysRemaining, executionCount, executionLimit, features, tier, status, isTrialing, isLoading, fetchSubscription]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};
