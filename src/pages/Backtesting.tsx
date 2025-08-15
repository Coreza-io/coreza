import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Play, BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { BacktestConfigModal } from '@/components/backtesting/BacktestConfigModal';
import { BacktestResults } from '@/components/backtesting/BacktestResults';

interface Backtest {
  [key: string]: any; // Allow any additional properties from Supabase
}

export default function Backtesting() {
  const { user } = useAuth();
  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBacktest, setSelectedBacktest] = useState<string | null>(null);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  useEffect(() => {
    if (user) {
      loadBacktests();
      loadWorkflows();
    }
  }, [user]);

  const loadBacktests = async () => {
    try {
      // First get backtests
      const { data: backtestsData, error: backtestsError } = await supabase
        .from('backtests')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (backtestsError) throw backtestsError;

      // Then get backtest results separately
      const { data: resultsData, error: resultsError } = await supabase
        .from('backtest_results')
        .select('backtest_id, total_return, final_portfolio_value');

      if (resultsError) throw resultsError;

      // Combine the data
      const backtestsWithResults = (backtestsData || []).map(backtest => {
        const results = resultsData?.filter(r => r.backtest_id === backtest.id) || [];
        return {
          ...backtest,
          backtest_results: results
        };
      });

      setBacktests(backtestsWithResults);
    } catch (error) {
      toast.error('Failed to load backtests');
      console.error('Error loading backtests:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkflows = async () => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('id, name')
        .eq('user_id', user?.id);

      if (error) throw error;
      setWorkflows(data || []);
    } catch (error) {
      console.error('Error loading workflows:', error);
    }
  };

  const handleCreateBacktest = async (config: any) => {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .insert({
          user_id: user?.id,
          workflow_id: config.workflow_id,
          name: config.name,
          description: config.description,
          start_date: config.start_date,
          end_date: config.end_date,
          initial_capital: config.initial_capital,
          commission_rate: config.commission_rate,
          slippage_rate: config.slippage_rate,
          data_frequency: config.data_frequency,
          status: 'pending'
        })
        .select()
        .single();

      if (error) throw error;

      toast.success('Backtest created successfully');
      setIsConfigModalOpen(false);
      loadBacktests();
    } catch (error) {
      toast.error('Failed to create backtest');
      console.error('Error creating backtest:', error);
    }
  };

  const handleRunBacktest = async (backtestId: string) => {
    try {
      // Update status to running
      await supabase
        .from('backtests')
        .update({ 
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', backtestId);

      toast.success('Backtest started');
      loadBacktests();

      // Call the Supabase edge function to run the backtest
      try {
        const { data, error } = await supabase.functions.invoke('run-backtest', {
          body: { backtestId }
        });

        if (error) {
          throw error;
        }

        console.log('Backtest execution started:', data);

        // Poll for completion status
        pollBacktestStatus(backtestId);
        
      } catch (apiError) {
        console.error('Failed to call edge function:', apiError);
        
        // Update status back to pending on error
        await supabase
          .from('backtests')
          .update({ 
            status: 'failed',
            error_message: 'Failed to start backtest execution'
          })
          .eq('id', backtestId);
          
        toast.error('Failed to start backtest execution');
        loadBacktests();
      }

    } catch (error) {
      toast.error('Failed to start backtest');
      console.error('Error running backtest:', error);
    }
  };

  const pollBacktestStatus = async (backtestId: string) => {
    const checkStatus = async () => {
      try {
        const { data: backtest, error } = await supabase
          .from('backtests')
          .select('status, completed_at, error_message')
          .eq('id', backtestId)
          .single();

        if (error) throw error;

        if (backtest.status === 'completed') {
          toast.success('Backtest completed successfully!');
          loadBacktests();
          return;
        } else if (backtest.status === 'failed') {
          toast.error(`Backtest failed: ${backtest.error_message || 'Unknown error'}`);
          loadBacktests();
          return;
        } else if (backtest.status === 'running') {
          // Continue polling
          setTimeout(checkStatus, 2000);
        }
      } catch (error) {
        console.error('Error checking backtest status:', error);
        setTimeout(checkStatus, 5000); // Retry in 5 seconds
      }
    };

    // Start polling after a short delay
    setTimeout(checkStatus, 2000);
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'secondary',
      running: 'default',
      completed: 'default',
      failed: 'destructive'
    } as const;

    const colors = {
      pending: 'bg-gray-100 text-gray-800',
      running: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800'
    } as const;

    return (
      <Badge 
        variant={variants[status as keyof typeof variants] || 'secondary'}
        className={colors[status as keyof typeof colors] || ''}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">Loading backtests...</div>
      </div>
    );
  }

  if (selectedBacktest) {
    return (
      <div className="p-6">
        <BacktestResults 
          backtestId={selectedBacktest}
          onBack={() => setSelectedBacktest(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Backtesting</h1>
          <p className="text-muted-foreground">
            Test your trading strategies against historical data
          </p>
        </div>
        <Button onClick={() => setIsConfigModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Backtest
        </Button>
      </div>

      <Tabs defaultValue="backtests" className="space-y-4">
        <TabsList>
          <TabsTrigger value="backtests">My Backtests</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="backtests" className="space-y-4">
          {backtests.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <BarChart3 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No backtests yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first backtest to analyze your trading strategies
                </p>
                <Button onClick={() => setIsConfigModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Backtest
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {backtests.map((backtest) => (
                <Card key={backtest.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{backtest.name}</CardTitle>
                        <CardDescription>
                          {workflows.find(w => w.id === backtest.workflow_id)?.name || 'Unknown Workflow'}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(backtest.status)}
                        {backtest.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRunBacktest(backtest.id);
                            }}
                          >
                            <Play className="h-4 w-4 mr-1" />
                            Run
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent 
                    className="space-y-3"
                    onClick={() => backtest.status === 'completed' && setSelectedBacktest(backtest.id)}
                  >
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Period</p>
                        <p className="font-medium">
                          {format(new Date(backtest.start_date), 'MMM dd, yyyy')} - {format(new Date(backtest.end_date), 'MMM dd, yyyy')}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Initial Capital</p>
                        <p className="font-medium">{formatCurrency(backtest.initial_capital)}</p>
                      </div>
                      {backtest.backtest_results?.[0] && (
                        <>
                          <div>
                            <p className="text-muted-foreground">Total Return</p>
                            <div className="flex items-center gap-1">
                              {backtest.backtest_results[0].total_return >= 0 ? (
                                <TrendingUp className="h-4 w-4 text-green-500" />
                              ) : (
                                <TrendingDown className="h-4 w-4 text-red-500" />
                              )}
                              <p className={`font-medium ${
                                backtest.backtest_results[0].total_return >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {formatPercentage(backtest.backtest_results[0].total_return)}
                              </p>
                            </div>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Final Value</p>
                            <p className="font-medium">{formatCurrency(backtest.backtest_results[0].final_portfolio_value)}</p>
                          </div>
                        </>
                      )}
                    </div>
                    {backtest.description && (
                      <p className="text-sm text-muted-foreground">{backtest.description}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Analytics</CardTitle>
              <CardDescription>
                Overall performance analysis across all backtests
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Analytics dashboard coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BacktestConfigModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        onSubmit={handleCreateBacktest}
        workflows={workflows}
      />
    </div>
  );
}