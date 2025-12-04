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

import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscriptionTier, useSubscription } from "@/contexts/SubscriptionContext";

interface FeatureComparisonProps {
  highlightTier?: SubscriptionTier;
}

const tierLabels: Record<SubscriptionTier, string> = {
  free: "Free",
  trader: "Trader",
  professional: "Professional",
  enterprise: "Enterprise",
};

const features = [
  {
    label: "Workflow executions per month",
    values: {
      free: "100",
      trader: "5,000",
      professional: "25,000",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Advanced indicators & screeners",
    values: { free: false, trader: true, professional: true, enterprise: true },
  },
  {
    label: "AI agents & LLM nodes",
    values: { free: false, trader: false, professional: true, enterprise: true },
  },
  {
    label: "Broker & exchange connectivity",
    values: { free: false, trader: true, professional: true, enterprise: true },
  },
  {
    label: "Priority & 24/7 support",
    values: { free: false, trader: false, professional: true, enterprise: true },
  },
];

const ValueCell = ({ value }: { value: string | boolean }) => {
  if (typeof value === "string") {
    return <span className="text-sm font-medium text-foreground">{value}</span>;
  }

  return value ? (
    <div className="flex items-center gap-1 text-primary">
      <Check className="h-4 w-4" />
      <span className="text-sm">Included</span>
    </div>
  ) : (
    <div className="flex items-center gap-1 text-muted-foreground">
      <Minus className="h-4 w-4" />
      <span className="text-sm">Not available</span>
    </div>
  );
};

export const FeatureComparison = ({ highlightTier }: FeatureComparisonProps) => {
  const { tier } = useSubscription();

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Compare plans</CardTitle>
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            You are on {tierLabels[tier]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {features.map((feature) => (
          <div key={feature.label} className="grid grid-cols-5 items-center gap-3 text-sm">
            <div className="col-span-2 font-medium text-foreground">{feature.label}</div>
            {(["free", "trader", "professional", "enterprise"] as SubscriptionTier[]).map((plan) => (
              <div
                key={plan}
                className={`flex flex-col items-start gap-1 ${highlightTier === plan ? "rounded-md bg-primary/5 p-2" : ""}`}
              >
                <Badge
                  variant="outline"
                  className={
                    highlightTier === plan
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }
                >
                  {tierLabels[plan]}
                </Badge>
                <ValueCell value={feature.values[plan as keyof typeof feature.values]} />
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
