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

import { useState } from "react";
import { Sparkles, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSubscription, SubscriptionTier } from "@/contexts/SubscriptionContext";
import { UpgradeModal } from "@/components/subscription/UpgradeModal";

interface FeatureGateProps {
  feature: string;
  requiredTier?: SubscriptionTier;
  children: React.ReactNode;
}

const tierLabels: Record<SubscriptionTier, string> = {
  free: "Free",
  trader: "Trader",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const FeatureGate = ({ children, feature, requiredTier = "professional" }: FeatureGateProps) => {
  const { tier, canUse } = useSubscription();
  const [open, setOpen] = useState(false);

  const tierRank: Record<SubscriptionTier, number> = {
    free: 0,
    trader: 1,
    professional: 2,
    enterprise: 3,
  };

  const meetsTierRequirement = tierRank[tier] >= tierRank[requiredTier];
  const isLocked = !canUse(feature) || !meetsTierRequirement;
  const showProfessionalBadge = requiredTier === "professional" || requiredTier === "enterprise";

  return (
    <div className="relative">
      <div className={isLocked ? "pointer-events-none select-none opacity-50 blur-[1px]" : ""}>{children}</div>
      {isLocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <Badge className="bg-gradient-primary text-white shadow">
              {showProfessionalBadge ? "Professional" : tierLabels[requiredTier]}
            </Badge>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Unlock this premium capability
            </div>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Lock className="h-4 w-4 mr-2" />
              View plans
            </Button>
          </div>
        </div>
      )}
      <UpgradeModal open={open} onOpenChange={setOpen} feature={feature} requiredTier={requiredTier} />
    </div>
  );
};
