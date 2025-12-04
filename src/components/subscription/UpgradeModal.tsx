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

import { Sparkles, ArrowRight, ShieldCheck, BadgeCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription, SubscriptionTier } from "@/contexts/SubscriptionContext";
import { UsageMeter } from "@/components/subscription/UsageMeter";
import { FeatureComparison } from "@/components/subscription/FeatureComparison";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: string;
  requiredTier?: SubscriptionTier;
}

const tierLabels: Record<SubscriptionTier, string> = {
  free: "Free",
  trader: "Trader",
  professional: "Professional",
  enterprise: "Enterprise",
};

export const UpgradeModal = ({ open, onOpenChange, feature, requiredTier = "professional" }: UpgradeModalProps) => {
  const { tier } = useSubscription();
  const isEligible = tier === "enterprise" || tier === requiredTier;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-6">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex items-center gap-3 text-2xl">
            <Sparkles className="h-6 w-6 text-primary" />
            Unlock this {feature ?? "premium"} feature
          </DialogTitle>
          <DialogDescription className="text-base">
            Upgrade to {tierLabels[requiredTier]} for deeper automation, higher execution limits, and dedicated support.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-5">
          <div className="md:col-span-2 space-y-4 rounded-lg border border-dashed p-4">
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                Current: {tierLabels[tier]}
              </Badge>
              <Badge variant="outline">{tierLabels[requiredTier]} required</Badge>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" />
                14-day trial on all paid plans
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BadgeCheck className="h-4 w-4" />
                Priority support on Professional and above
              </div>
            </div>
            <UsageMeter />
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              {isEligible ? "Continue with your plan" : "Upgrade my plan"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
          <div className="md:col-span-3">
            <FeatureComparison highlightTier={requiredTier} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
