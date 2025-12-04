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

export type SubscriptionTier = "free" | "trader" | "professional" | "enterprise";

export interface SubscriptionContextType {
  tier: SubscriptionTier;
  features: string[];
  executionCount: number;
  executionLimit: number;
  canUse: (feature: string) => boolean;
  isTrialing: boolean;
  daysRemaining: number | null;
}

const tierOrder: SubscriptionTier[] = ["free", "trader", "professional", "enterprise"];

const tierConfig: Record<SubscriptionTier, { features: string[]; executionLimit: number; trial: boolean }> = {
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
    trial: false,
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
    trial: true,
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
    trial: true,
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
    trial: false,
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
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [executionCount, setExecutionCount] = useState(0);
  const [trialEndsAt, setTrialEndsAt] = useState<Date | null>(null);

  useEffect(() => {
    const storedTier = localStorage.getItem("coreza-subscription-tier") as SubscriptionTier | null;
    const storedUsage = localStorage.getItem("coreza-subscription-usage");

    if (storedTier && tierOrder.includes(storedTier)) {
      setTier(storedTier);
    }

    if (storedUsage) {
      const parsed = parseInt(storedUsage, 10);
      if (!Number.isNaN(parsed)) {
        setExecutionCount(parsed);
      }
    }

    if (tierConfig[tier].trial) {
      const storedTrialEnd = localStorage.getItem("coreza-trial-end");
      if (storedTrialEnd) {
        const parsedDate = new Date(storedTrialEnd);
        if (!Number.isNaN(parsedDate.getTime())) {
          setTrialEndsAt(parsedDate);
          return;
        }
      }

      const nextTwoWeeks = new Date();
      nextTwoWeeks.setDate(nextTwoWeeks.getDate() + 14);
      setTrialEndsAt(nextTwoWeeks);
      localStorage.setItem("coreza-trial-end", nextTwoWeeks.toISOString());
    }
  }, [tier]);

  const features = useMemo(() => tierConfig[tier].features, [tier]);
  const executionLimit = tierConfig[tier].executionLimit;
  const isTrialing = tierConfig[tier].trial;

  const daysRemaining = useMemo(() => {
    if (!trialEndsAt) return null;
    const diff = trialEndsAt.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [trialEndsAt]);

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
      features,
      executionCount,
      executionLimit,
      canUse,
      isTrialing,
      daysRemaining,
    }),
    [canUse, daysRemaining, executionCount, executionLimit, features, tier, isTrialing]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};
