import { useId, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface Props {
  children: ReactNode;
  persistent?: boolean;
  onPersistentChange?: (checked: boolean) => void;
  incomingEdgeCount: number;
  checkDependency: boolean;
  onDependencyCheckChange: (checked: boolean) => void;
  continueOnError: boolean;
  onContinueOnErrorChange: (checked: boolean) => void;
  continueOnErrorDisabled?: boolean;
  readOnly?: boolean;
}

export function NodeConfigurationTabs({ children, persistent, onPersistentChange, incomingEdgeCount, checkDependency, onDependencyCheckChange, continueOnError, onContinueOnErrorChange, continueOnErrorDisabled, readOnly }: Props) {
  const persistentId = useId();
  const dependencyId = useId();
  const continueId = useId();

  return (
    <Tabs defaultValue="parameters" className="nodrag nopan w-full">
      <TabsList aria-label="Node configuration" className="h-9 w-fit justify-start gap-4 rounded-none border-b border-border bg-transparent p-0">
        <TabsTrigger value="parameters" className="rounded-none border-b-2 border-transparent px-1 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">Parameters</TabsTrigger>
        <TabsTrigger value="settings" className="rounded-none border-b-2 border-transparent px-1 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">Settings</TabsTrigger>
      </TabsList>
      {/* Keep field drafts and component-owned node controls mounted across tab changes. */}
      <TabsContent value="parameters" forceMount className="space-y-3 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
      <TabsContent value="settings" forceMount className="space-y-3 data-[state=inactive]:hidden">
        {onPersistentChange ? (
          <>
            <div className="flex items-center justify-between gap-3 pt-1">
              <Label htmlFor={persistentId} className="text-xs text-muted-foreground cursor-pointer">
                Persistent
              </Label>
              <Switch id={persistentId} checked={Boolean(persistent)} onCheckedChange={onPersistentChange} disabled={readOnly} />
            </div>
            {persistent && (
              <p className="text-xs text-muted-foreground">Execute saves String, Number and Boolean fields as workflow variables. Use {"{{ $vars.name }}"} in following nodes.</p>
            )}
          </>
        ) : null}
        {incomingEdgeCount >= 2 ? (
          <div className="flex items-center justify-between gap-3 pt-1">
            <Label htmlFor={dependencyId} className="text-xs text-muted-foreground cursor-pointer">
              Skip dependency check
            </Label>
            <Switch id={dependencyId} checked={checkDependency} onCheckedChange={onDependencyCheckChange} disabled={readOnly} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 pt-1">
          <Label htmlFor={continueId} className="text-xs text-muted-foreground cursor-pointer">
            Continue on Error
          </Label>
          <Switch id={continueId} checked={continueOnError && !continueOnErrorDisabled} onCheckedChange={onContinueOnErrorChange} disabled={readOnly || continueOnErrorDisabled} />
        </div>
        <p className="text-xs text-muted-foreground">
          {continueOnErrorDisabled ? "Persistent variable errors must stop execution." : "Pass error details to the next node instead of stopping execution."}
        </p>
      </TabsContent>
    </Tabs>
  );
}
