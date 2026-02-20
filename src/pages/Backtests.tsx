import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useBacktests, BacktestStatus } from "@/hooks/useBacktests";
import { NewBacktestDialog } from "@/components/backtest/NewBacktestDialog";
import { MoreHorizontal, Plus, Search, Trash2, BarChart2, CheckCircle2, PlayCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const statusConfig: Record<BacktestStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
  pending:   { label: 'Pending',   variant: 'outline',     className: 'text-muted-foreground' },
  running:   { label: 'Running',   variant: 'secondary',   className: 'text-amber-500' },
  completed: { label: 'Completed', variant: 'default',     className: 'text-green-500' },
  failed:    { label: 'Failed',    variant: 'destructive', className: 'text-destructive' },
};

const fmt = (val: number | undefined, suffix = '', decimals = 2) =>
  val !== undefined && val !== null ? `${val.toFixed(decimals)}${suffix}` : '—';

const fmtReturn = (val: number | undefined) => {
  if (val === undefined || val === null) return <span className="text-muted-foreground">—</span>;
  const cls = val >= 0 ? 'text-green-500' : 'text-destructive';
  return <span className={cls}>{val >= 0 ? '+' : ''}{val.toFixed(2)}%</span>;
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
      toast({ title: 'Failed to delete backtest', description: err.message, variant: 'destructive' });
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
        <Button variant="secondary" className="gap-2 self-start" onClick={() => setShowNewDialog(true)}>
          <Plus className="h-4 w-4" /> New Backtest
        </Button>
      </div>

      {/* Stats */}
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

      {/* Table */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>Backtests</CardTitle>
            <div className="flex flex-wrap gap-2">
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
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="h-12 rounded-lg bg-muted animate-pulse" />
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
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total Return</TableHead>
                    <TableHead className="text-right">Sharpe Ratio</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((backtest) => (
                    <TableRow
                      key={backtest.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => window.location.href = `/dashboard/backtests/${backtest.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          to={`/dashboard/backtests/${backtest.id}`}
                          className="hover:underline flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {backtest.name}
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {backtest.workflow_name ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusConfig[backtest.status].variant}>
                          {statusConfig[backtest.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {fmtReturn(backtest.total_return)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {backtest.sharpe_ratio !== undefined && backtest.sharpe_ratio !== null
                          ? <span className={backtest.sharpe_ratio >= 1 ? 'text-green-500' : 'text-muted-foreground'}>{fmt(backtest.sharpe_ratio)}</span>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {backtest.total_trades ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {backtest.created_at ? new Date(backtest.created_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
    <div className="flex gap-2 flex-wrap">
      {(['all', 'pending', 'running', 'completed', 'failed'] as const).map((status) => (
        <Button
          key={status}
          variant={value === status ? 'default' : 'outline'}
          size="sm"
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
