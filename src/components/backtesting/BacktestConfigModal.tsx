import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface BacktestConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: any) => void;
  workflows: Array<{ id: string; name: string }>;
  editData?: any;
}

export function BacktestConfigModal({ isOpen, onClose, onSubmit, workflows, editData }: BacktestConfigModalProps) {
  const [config, setConfig] = useState({
    name: '',
    description: '',
    workflow_id: '',
    start_date: undefined as Date | undefined,
    end_date: undefined as Date | undefined,
    initial_capital: 10000,
    commission_rate: 0.001,
    slippage_rate: 0.001,
    data_frequency: '1d'
  });

  useEffect(() => {
    if (editData) {
      setConfig({
        name: editData.name || '',
        description: editData.description || '',
        workflow_id: editData.workflow_id || '',
        start_date: editData.start_date ? new Date(editData.start_date) : undefined,
        end_date: editData.end_date ? new Date(editData.end_date) : undefined,
        initial_capital: editData.initial_capital || 10000,
        commission_rate: editData.commission_rate || 0.001,
        slippage_rate: editData.slippage_rate || 0.001,
        data_frequency: editData.data_frequency || '1d'
      });
    } else {
      setConfig({
        name: '',
        description: '',
        workflow_id: '',
        start_date: undefined,
        end_date: undefined,
        initial_capital: 10000,
        commission_rate: 0.001,
        slippage_rate: 0.001,
        data_frequency: '1d'
      });
    }
  }, [editData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!config.name || !config.workflow_id || !config.start_date || !config.end_date) {
      return;
    }

    onSubmit({
      ...config,
      start_date: config.start_date.toISOString().split('T')[0],
      end_date: config.end_date.toISOString().split('T')[0]
    });
  };

  const handleClose = () => {
    setConfig({
      name: '',
      description: '',
      workflow_id: '',
      start_date: undefined,
      end_date: undefined,
      initial_capital: 10000,
      commission_rate: 0.001,
      slippage_rate: 0.001,
      data_frequency: '1d'
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{editData ? 'Edit Backtest' : 'Create New Backtest'}</DialogTitle>
          <DialogDescription>
            Configure your backtest parameters to analyze strategy performance
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Backtest Name *</Label>
              <Input
                id="name"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="My Strategy Backtest"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workflow">Strategy Workflow *</Label>
              <Select
                value={config.workflow_id}
                onValueChange={(value) => setConfig({ ...config, workflow_id: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select workflow" />
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={config.description}
              onChange={(e) => setConfig({ ...config, description: e.target.value })}
              placeholder="Optional description of your backtest strategy..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !config.start_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {config.start_date ? format(config.start_date, "PPP") : "Pick start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={config.start_date}
                    onSelect={(date) => setConfig({ ...config, start_date: date })}
                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>End Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !config.end_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {config.end_date ? format(config.end_date, "PPP") : "Pick end date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={config.end_date}
                    onSelect={(date) => setConfig({ ...config, end_date: date })}
                    disabled={(date) => 
                      date > new Date() || 
                      date < new Date("1900-01-01") ||
                      (config.start_date && date <= config.start_date)
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="initial_capital">Initial Capital ($)</Label>
              <Input
                id="initial_capital"
                type="number"
                value={config.initial_capital}
                onChange={(e) => setConfig({ ...config, initial_capital: parseFloat(e.target.value) })}
                min="1000"
                step="1000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data_frequency">Data Frequency</Label>
              <Select
                value={config.data_frequency}
                onValueChange={(value) => setConfig({ ...config, data_frequency: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">1 Minute</SelectItem>
                  <SelectItem value="5m">5 Minutes</SelectItem>
                  <SelectItem value="15m">15 Minutes</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                  <SelectItem value="1d">1 Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="commission_rate">Commission Rate (%)</Label>
              <Input
                id="commission_rate"
                type="number"
                value={config.commission_rate * 100}
                onChange={(e) => setConfig({ ...config, commission_rate: parseFloat(e.target.value) / 100 })}
                min="0"
                max="10"
                step="0.01"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slippage_rate">Slippage Rate (%)</Label>
              <Input
                id="slippage_rate"
                type="number"
                value={config.slippage_rate * 100}
                onChange={(e) => setConfig({ ...config, slippage_rate: parseFloat(e.target.value) / 100 })}
                min="0"
                max="10"
                step="0.01"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">
              {editData ? 'Update Backtest' : 'Create Backtest'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}