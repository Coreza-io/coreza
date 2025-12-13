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

import { createContext, useCallback, useContext, useMemo } from "react";

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

// All features unlocked for open source version
const allFeatures = [
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
];

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscription must be used within a SubscriptionProvider");
  }
  return context;
};

export const SubscriptionProvider = ({ children }: { children: React.ReactNode }) => {
  // Open source: Always enterprise tier with all features unlocked
  const canUse = useCallback(() => true, []);
  
  const refreshSubscription = useCallback(async () => {
    // No-op for open source version
  }, []);

  const value = useMemo(
    () => ({
      tier: "enterprise" as SubscriptionTier,
      status: "active" as SubscriptionStatus,
      features: allFeatures,
      executionCount: 0,
      executionLimit: Infinity,
      canUse,
      isTrialing: false,
      daysRemaining: null,
      isLoading: false,
      refreshSubscription,
    }),
    [canUse, refreshSubscription]
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
};
