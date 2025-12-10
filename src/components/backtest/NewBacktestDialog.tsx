import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

interface WorkflowOption {
  id: string;
  name: string;
}

interface NewBacktestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export const NewBacktestDialog = ({ open, onOpenChange, onCreated }: NewBacktestDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    workflowId: '',
    initialCapital: 10000,
    commissionType: 'none',
    commissionValue: 0,
    slippageType: 'none',
    slippageValue: 0,
    notes: '',
  });

  useEffect(() => {
    const loadWorkflows = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('workflows')
        .select('id, name')
        .eq('user_id', user.id)
        .order('name');

      setWorkflows(data || []);
    };

    loadWorkflows();
  }, [user]);

  const canSubmit = useMemo(() => {
    return !!formData.name && !!formData.workflowId && !loading;
  }, [formData.name, formData.workflowId, loading]);

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        workflow_id: formData.workflowId,
        user_id: user.id,
        status: 'pending',
        config: {
          initial_capital: formData.initialCapital,
          commission: {
            type: formData.commissionType,
            value: Number(formData.commissionValue),
          },
          slippage: {
            type: formData.slippageType,
            value: Number(formData.slippageValue),
          },
          notes: formData.notes,
        },
      };

      const { error } = await supabase.from('backtests').insert(payload);
      if (error) throw error;

      toast({ title: 'Backtest created', description: 'Your backtest has been queued for execution.' });
      onOpenChange(false);
      onCreated?.();
      setFormData({
        name: '',
        workflowId: '',
        initialCapital: 10000,
        commissionType: 'none',
        commissionValue: 0,
        slippageType: 'none',
        slippageValue: 0,
        notes: '',
      });
    } catch (err: any) {
      console.error('Error creating backtest', err);
      toast({
        title: 'Failed to create backtest',
        description: err.message || 'Please try again later',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Backtest</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="RSI Strategy Backtest"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Workflow</Label>
            <Select
              value={formData.workflowId}
              onValueChange={(value) => setFormData({ ...formData, workflowId: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="initial-capital">Initial Capital</Label>
              <Input
                id="initial-capital"
                type="number"
                value={formData.initialCapital}
                onChange={(e) => setFormData({ ...formData, initialCapital: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="commission-type">Commission Type</Label>
              <Select
                value={formData.commissionType}
                onValueChange={(value) => setFormData({ ...formData, commissionType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="per_share">Per Share</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="commission-value">Commission Value</Label>
              <Input
                id="commission-value"
                type="number"
                value={formData.commissionValue}
                onChange={(e) => setFormData({ ...formData, commissionValue: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slippage-type">Slippage Type</Label>
              <Select
                value={formData.slippageType}
                onValueChange={(value) => setFormData({ ...formData, slippageType: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="slippage-value">Slippage Value</Label>
              <Input
                id="slippage-value"
                type="number"
                value={formData.slippageValue}
                onChange={(e) => setFormData({ ...formData, slippageValue: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Optional notes about this backtest"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || loading}>
            {loading ? 'Creating...' : 'Create Backtest'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
