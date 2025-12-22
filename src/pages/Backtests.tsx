import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useBacktests, BacktestStatus } from "@/hooks/useBacktests";
import { NewBacktestDialog } from "@/components/backtest/NewBacktestDialog";
import { MoreHorizontal, Plus, Search, Trash2, BarChart2, CheckCircle2, PlayCircle, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/utils/getErrorMessage";

const statusConfig: Record<BacktestStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: 'Pending', variant: 'outline' },
  running: { label: 'Running', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  failed: { label: 'Failed', variant: 'destructive' },
};

const Backtests = () => {
  const { backtests, loading, stats, refetch } = useBacktests();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BacktestStatus | 'all'>('all');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    return backtests.filter((backtest) => {
      const matchesSearch = backtest.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || backtest.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [backtests, search, statusFilter]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('backtests').delete().eq('id', deleteId);
      if (error) throw error;
      toast({ title: 'Backtest deleted' });
      refetch();
    } catch (err: any) {
      toast({
        title: 'Failed to delete backtest',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Backtests</h1>
          <p className="text-muted-foreground">Manage and review your strategy backtests.</p>
        </div>
        <div className="flex gap-3">
          <Button variant={statusFilter === 'all' ? 'default' : 'outline'} onClick={() => setStatusFilter('all')}>
            All
          </Button>
          <Button variant="secondary" className="gap-2" onClick={() => setShowNewDialog(true)}>
            <Plus className="h-4 w-4" /> New Backtest
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Backtests</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" /> {stats.completed}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Running</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-amber-500" /> {stats.running}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" /> {stats.failed}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>Backtests</CardTitle>
            <div className="flex gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search backtests"
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <SelectStatus value={statusFilter} onChange={setStatusFilter} />
            </div>
          </div>
          <CardDescription>
            View all of your strategy backtests and access detailed performance results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-40 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <BarChart2 className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-semibold">No backtests found</p>
                <p className="text-muted-foreground text-sm">Create your first backtest to get started.</p>
              </div>
              <Button onClick={() => setShowNewDialog(true)}>New Backtest</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((backtest, index) => (
                <motion.div
                  key={backtest.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <Card className="h-full">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                      <div>
                        <CardTitle className="text-xl">{backtest.name}</CardTitle>
                        <CardDescription>{backtest.workflow_name ? `Workflow: ${backtest.workflow_name}` : 'Workflow'}</CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to={`/dashboard/backtests/${backtest.id}`}>View Results</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteId(backtest.id)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusConfig[backtest.status].variant}>{statusConfig[backtest.status].label}</Badge>
                        <p className="text-xs text-muted-foreground">
                          {backtest.updated_at ? new Date(backtest.updated_at).toLocaleString() : ''}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Total Return</p>
                          <p className="text-lg font-semibold">{backtest.total_return ? `${backtest.total_return.toFixed(2)}%` : '—'}</p>
                        </div>
                        <div className="rounded-lg border p-3">
                          <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                          <p className="text-lg font-semibold">{backtest.sharpe_ratio ? backtest.sharpe_ratio.toFixed(2) : '—'}</p>
                        </div>
                      </div>
                      <Button asChild className="w-full" variant="secondary">
                        <Link to={`/dashboard/backtests/${backtest.id}`}>View Results</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewBacktestDialog open={showNewDialog} onOpenChange={setShowNewDialog} onCreated={refetch} />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backtest?</AlertDialogTitle>
            <CardDescription>This action cannot be undone.</CardDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const SelectStatus = ({ value, onChange }: { value: BacktestStatus | 'all'; onChange: (value: BacktestStatus | 'all') => void }) => {
  return (
    <div className="flex gap-2">
      {(['all', 'pending', 'running', 'completed', 'failed'] as const).map((status) => (
        <Button
          key={status}
          variant={value === status ? 'default' : 'outline'}
          onClick={() => onChange(status as BacktestStatus | 'all')}
          className="capitalize"
        >
          {status}
        </Button>
      ))}
    </div>
  );
};

export default Backtests;
