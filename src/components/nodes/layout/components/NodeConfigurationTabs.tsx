import { useId, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  children: ReactNode;
  incomingEdgeCount: number;
  checkDependency: boolean;
  onDependencyCheckChange: (checked: boolean) => void;
  readOnly?: boolean;
}

export function NodeConfigurationTabs({ children, incomingEdgeCount, checkDependency, onDependencyCheckChange, readOnly }: Props) {
  const dependencyId = useId();

  return (
    <Tabs defaultValue="parameters" className="nodrag nopan w-full">
      <TabsList aria-label="Node configuration" className="grid w-full grid-cols-2">
        <TabsTrigger value="parameters">Parameters</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      {/* Keep field drafts and component-owned node controls mounted across tab changes. */}
      <TabsContent value="parameters" forceMount className="space-y-3 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
      <TabsContent value="settings" forceMount className="space-y-3 data-[state=inactive]:hidden">
        {incomingEdgeCount >= 2 ? (
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label htmlFor={dependencyId} className="text-xs text-muted-foreground cursor-pointer">
              Skip dependency check
            </Label>
            <Switch id={dependencyId} checked={checkDependency} onCheckedChange={onDependencyCheckChange} disabled={readOnly} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No additional settings for this node.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}
