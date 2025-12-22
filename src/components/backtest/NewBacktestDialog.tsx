import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
    startDate: undefined as Date | undefined,
    endDate: undefined as Date | undefined,
    initialCapital: 10000,
    commissionRate: 0.001,
    slippageRate: 0.001,
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
    return !!formData.name && !!formData.workflowId && !!formData.startDate && !!formData.endDate && !loading;
  }, [formData.name, formData.workflowId, formData.startDate, formData.endDate, loading]);

  const handleSubmit = async () => {
    if (!user || !formData.startDate || !formData.endDate) return;
    setLoading(true);

    try {
      const payload = {
        name: formData.name,
        workflow_id: formData.workflowId,
        user_id: user.id,
        status: 'pending',
        start_date: format(formData.startDate, 'yyyy-MM-dd'),
        end_date: format(formData.endDate, 'yyyy-MM-dd'),
        initial_capital: formData.initialCapital,
        commission_rate: formData.commissionRate,
        slippage_rate: formData.slippageRate,
        description: formData.notes || null,
        data_frequency: '1d',
      };

      const { error } = await supabase.from('backtests').insert(payload);
      if (error) throw error;

      toast({ title: 'Backtest created', description: 'Your backtest has been queued for execution.' });
      onOpenChange(false);
      onCreated?.();
      setFormData({
        name: '',
        workflowId: '',
        startDate: undefined,
        endDate: undefined,
        initialCapital: 10000,
        commissionRate: 0.001,
        slippageRate: 0.001,
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
              <Label>Start Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.startDate ? format(formData.startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.startDate}
                    onSelect={(date) => setFormData({ ...formData, startDate: date })}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !formData.endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.endDate ? format(formData.endDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.endDate}
                    onSelect={(date) => setFormData({ ...formData, endDate: date })}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
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
              <Label htmlFor="commission-rate">Commission Rate</Label>
              <Input
                id="commission-rate"
                type="number"
                step="0.0001"
                value={formData.commissionRate}
                onChange={(e) => setFormData({ ...formData, commissionRate: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slippage-rate">Slippage Rate</Label>
              <Input
                id="slippage-rate"
                type="number"
                step="0.0001"
                value={formData.slippageRate}
                onChange={(e) => setFormData({ ...formData, slippageRate: Number(e.target.value) })}
              />
            </div>
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
