import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  PlayCircle, 
  Plus,
  BarChart3,
  Loader2
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from "@/contexts/AuthContext";

const Dashboard = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState({
    activeWorkflows: 0,
    totalWorkflows: 0,
    recentWorkflows: [] as any[],
    performanceData: [] as any[],
    successRate: 0,
    totalRuns: 0
  });
  const [executionHistory, setExecutionHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeWorkflowsData, setActiveWorkflowsData] = useState<any[]>([]);
  const [activeWorkflowsLoading, setActiveWorkflowsLoading] = useState(false);
  const [allWorkflowsData, setAllWorkflowsData] = useState<any[]>([]);
  const [allWorkflowsLoading, setAllWorkflowsLoading] = useState(false);
  const [performanceStats, setPerformanceStats] = useState<any[]>([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const { toast } = useToast();

  // Fetch dashboard data
  useEffect(() => {
    if (!user) return;
    
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // Fetch workflows
        const { data: workflows, error: workflowsError } = await supabase
          .from('workflows')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (workflowsError) {
          console.error('Error fetching workflows:', workflowsError);
          toast({
            title: "Error",
            description: "Failed to load dashboard data",
            variant: "destructive",
          });
          return;
        }

        const activeWorkflows = workflows?.filter(w => w.is_active) || [];
        
        // Fetch workflow runs statistics for success rate calculation
        const { data: workflowRunsStats, error: runsError } = await supabase
          .from('workflow_runs')
          .select(`
            status,
            workflow_id,
            workflows!inner(user_id)
          `)
          .eq('workflows.user_id', user.id);

        if (runsError) {
          console.error('Error fetching workflow runs:', runsError);
        }

        // Calculate success rate
        let successRate = 0;
        let totalRuns = 0;
        
        if (workflowRunsStats && workflowRunsStats.length > 0) {
          totalRuns = workflowRunsStats.length;
          const successfulRuns = workflowRunsStats.filter(run => run.status === 'success').length;
          successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;
        }
        
        // Generate mock performance data for now (you can replace this with real data later)
        const performanceData = Array.from({ length: 30 }, (_, i) => ({
          date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: Math.floor(Math.random() * 1000) + 500
        }));

        setDashboardData({
          activeWorkflows: activeWorkflows.length,
          totalWorkflows: workflows?.length || 0,
          recentWorkflows: workflows?.slice(0, 3) || [],
          performanceData,
          successRate,
          totalRuns
        });

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        toast({
          title: "Error",
          description: "Failed to load dashboard data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user, toast]);

  // Fetch detailed execution history
  const fetchExecutionHistory = async () => {
    if (!user) return;
    
    setHistoryLoading(true);
    try {
      const { data: workflowRuns, error } = await supabase
        .from('workflow_runs')
        .select(`
          id,
          status,
          started_at,
          completed_at,
          error_message,
          workflows!inner(name, user_id)
        `)
        .eq('workflows.user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching execution history:', error);
        toast({
          title: "Error",
          description: "Failed to load execution history",
          variant: "destructive",
        });
        return;
      }

      setExecutionHistory(workflowRuns || []);
    } catch (error) {
      console.error('Error fetching execution history:', error);
      toast({
        title: "Error",
        description: "Failed to load execution history",
        variant: "destructive",
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  // Fetch active workflows data
  const fetchActiveWorkflows = async () => {
    if (!user) return;
    
    setActiveWorkflowsLoading(true);
    try {
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          created_at,
          updated_at,
          is_active,
          projects(name)
        `)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching active workflows:', error);
        toast({
          title: "Error",
          description: "Failed to load active workflows",
          variant: "destructive",
        });
        return;
      }

      setActiveWorkflowsData(workflows || []);
    } catch (error) {
      console.error('Error fetching active workflows:', error);
    } finally {
      setActiveWorkflowsLoading(false);
    }
  };

  // Fetch all workflows data
  const fetchAllWorkflows = async () => {
    if (!user) return;
    
    setAllWorkflowsLoading(true);
    try {
      const { data: workflows, error } = await supabase
        .from('workflows')
        .select(`
          id,
          name,
          created_at,
          updated_at,
          is_active,
          projects(name)
        `)
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching all workflows:', error);
        toast({
          title: "Error",
          description: "Failed to load workflows",
          variant: "destructive",
        });
        return;
      }

      setAllWorkflowsData(workflows || []);
    } catch (error) {
      console.error('Error fetching all workflows:', error);
    } finally {
      setAllWorkflowsLoading(false);
    }
  };

  // Fetch performance statistics
  const fetchPerformanceStats = async () => {
    if (!user) return;
    
    setPerformanceLoading(true);
    try {
      const { data: workflowRuns, error } = await supabase
        .from('workflow_runs')
        .select(`
          id,
          status,
          started_at,
          completed_at,
          workflows!inner(name, user_id)
        `)
        .eq('workflows.user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('Error fetching performance stats:', error);
        toast({
          title: "Error",
          description: "Failed to load performance statistics",
          variant: "destructive",
        });
        return;
      }

      // Calculate performance metrics
      const stats = workflowRuns?.map(run => {
        const runtime = run.completed_at ? 
          Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000) : 
          null;
        
        return {
          workflow_name: run.workflows?.name || 'Unknown',
          status: run.status,
          runtime,
          started_at: run.started_at,
          completed_at: run.completed_at
        };
      }) || [];

      setPerformanceStats(stats);
    } catch (error) {
      console.error('Error fetching performance stats:', error);
    } finally {
      setPerformanceLoading(false);
    }
  };

  // Calculate run time for completed executions
  const getRunTime = (startedAt: string, completedAt: string | null) => {
    if (!completedAt) return "Running...";
    
    const start = new Date(startedAt);
    const end = new Date(completedAt);
    const diffMs = end.getTime() - start.getTime();
    const diffSeconds = Math.round(diffMs / 1000);
    
    if (diffSeconds < 60) return `${diffSeconds}s`;
    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const diffHours = Math.round(diffMinutes / 60);
    return `${diffHours}h`;
  };

  // Calculate dynamic stats based on real data
  const stats = [
    {
      title: "Active Workflows",
      value: loading ? "..." : dashboardData.activeWorkflows.toString(),
      change: `${dashboardData.totalWorkflows} total`,
      icon: Activity,
      trend: "neutral" as const
    },
    {
      title: "Total Workflows",
      value: loading ? "..." : dashboardData.totalWorkflows.toString(),
      change: `${dashboardData.activeWorkflows} active`,
      icon: DollarSign,
      trend: "neutral" as const
    },
    {
      title: "Success Rate",
      value: loading ? "..." : dashboardData.totalRuns > 0 ? `${dashboardData.successRate}%` : "No data",
      change: dashboardData.totalRuns > 0 ? `${dashboardData.totalRuns} total runs` : "No executions yet",
      icon: TrendingUp,
      trend: dashboardData.successRate >= 80 ? "up" as const : dashboardData.successRate >= 60 ? "neutral" as const : "down" as const
    },
    {
      title: "Performance",
      value: "N/A",
      change: "Coming soon",
      icon: PlayCircle,
      trend: "neutral" as const
    }
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your workflow overview.
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/workflow/new">
            <Button className="bg-gradient-primary hover:shadow-glow">
              <Plus className="h-4 w-4 mr-2" />
              New Workflow
            </Button>
          </Link>
        </div>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        {stats.map((stat, index) => (
          <motion.div key={stat.title} variants={item}>
            {stat.title === "Active Workflows" ? (
              <Dialog onOpenChange={(open) => {
                if (open) {
                  fetchActiveWorkflows();
                }
              }}>
                <DialogTrigger asChild>
                  <Card className="bg-gradient-card border-border hover:shadow-card transition-all cursor-pointer">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {stat.title}
                      </CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <p className="text-xs text-muted-foreground">
                        {stat.change}
                      </p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Active Workflows</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh]">
                    {activeWorkflowsLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2">Loading active workflows...</span>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Workflow Name</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Created Date</TableHead>
                            <TableHead>Last Updated</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activeWorkflowsData.length > 0 ? (
                            activeWorkflowsData.map((workflow) => (
                              <TableRow key={workflow.id}>
                                <TableCell className="font-medium">
                                  {workflow.name}
                                </TableCell>
                                <TableCell>
                                  {workflow.projects?.name || 'No Project'}
                                </TableCell>
                                <TableCell>
                                  {new Date(workflow.created_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  {new Date(workflow.updated_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="default">Active</Badge>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                No active workflows found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            ) : stat.title === "Total Workflows" ? (
              <Dialog onOpenChange={(open) => {
                if (open) {
                  fetchAllWorkflows();
                }
              }}>
                <DialogTrigger asChild>
                  <Card className="bg-gradient-card border-border hover:shadow-card transition-all cursor-pointer">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {stat.title}
                      </CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <p className="text-xs text-muted-foreground">
                        {stat.change}
                      </p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>All Workflows</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh]">
                    {allWorkflowsLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2">Loading workflows...</span>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Workflow Name</TableHead>
                            <TableHead>Project</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Created Date</TableHead>
                            <TableHead>Last Updated</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {allWorkflowsData.length > 0 ? (
                            allWorkflowsData.map((workflow) => (
                              <TableRow key={workflow.id}>
                                <TableCell className="font-medium">
                                  {workflow.name}
                                </TableCell>
                                <TableCell>
                                  {workflow.projects?.name || 'No Project'}
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant={workflow.is_active ? 'default' : 'secondary'}
                                  >
                                    {workflow.is_active ? 'Active' : 'Paused'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {new Date(workflow.created_at).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  {new Date(workflow.updated_at).toLocaleDateString()}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                No workflows found
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            ) : stat.title === "Performance" ? (
              <Dialog onOpenChange={(open) => {
                if (open) {
                  fetchPerformanceStats();
                }
              }}>
                <DialogTrigger asChild>
                  <Card className="bg-gradient-card border-border hover:shadow-card transition-all cursor-pointer">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {stat.title}
                      </CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <p className="text-xs text-muted-foreground">
                        {stat.change}
                      </p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Performance Statistics</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh]">
                    {performanceLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2">Loading performance data...</span>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Workflow Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Runtime</TableHead>
                            <TableHead>Started Time</TableHead>
                            <TableHead>Completed Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {performanceStats.length > 0 ? (
                            performanceStats.map((stat, index) => (
                              <TableRow key={index}>
                                <TableCell className="font-medium">
                                  {stat.workflow_name}
                                </TableCell>
                                <TableCell>
                                  <Badge 
                                    variant={stat.status === 'success' ? 'default' : 
                                            stat.status === 'failed' ? 'destructive' : 'secondary'}
                                  >
                                    {stat.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {stat.runtime ? `${stat.runtime}s` : 'Running...'}
                                </TableCell>
                                <TableCell>
                                  {new Date(stat.started_at).toLocaleString()}
                                </TableCell>
                                <TableCell>
                                  {stat.completed_at ? new Date(stat.completed_at).toLocaleString() : 'N/A'}
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                No performance data available
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            ) : stat.title === "Success Rate" && dashboardData.totalRuns > 0 ? (
              <Dialog onOpenChange={(open) => {
                if (open) {
                  fetchExecutionHistory();
                }
              }}>
                <DialogTrigger asChild>
                  <Card className="bg-gradient-card border-border hover:shadow-card transition-all cursor-pointer">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">
                        {stat.title}
                      </CardTitle>
                      <stat.icon className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <p className="text-xs text-muted-foreground">
                        {stat.change}
                      </p>
                    </CardContent>
                  </Card>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[80vh]">
                  <DialogHeader>
                    <DialogTitle>Workflow Execution History</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[60vh]">
                    {historyLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span className="ml-2">Loading execution history...</span>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Workflow Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Started Time</TableHead>
                            <TableHead>Run Time</TableHead>
                            <TableHead>Execution ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {executionHistory.map((run) => (
                            <TableRow key={run.id}>
                              <TableCell className="font-medium">
                                {run.workflows?.name || 'Unknown'}
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={run.status === 'success' ? 'default' : 
                                          run.status === 'failed' ? 'destructive' : 'secondary'}
                                >
                                  {run.status}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {new Date(run.started_at).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                {getRunTime(run.started_at, run.completed_at)}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {run.id.slice(0, 8)}...
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            ) : (
              <Card className="bg-gradient-card border-border hover:shadow-card transition-all">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {stat.title}
                  </CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground">
                    {stat.change}
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.div>
        ))}
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="bg-gradient-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Recent Workflows
              </CardTitle>
              <CardDescription>
                Your latest trading strategies
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dashboardData.recentWorkflows.length > 0 ? (
                  dashboardData.recentWorkflows.map((workflow, index) => (
                    <div key={workflow.id || index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div>
                        <p className="font-medium">{workflow.name}</p>
                        <p className="text-sm text-muted-foreground capitalize">
                          Status: {workflow.is_active ? 'Active' : 'Paused'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created: {new Date(workflow.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className={`w-2 h-2 rounded-full ${
                          workflow.is_active ? 'bg-success' : 'bg-warning'
                        }`} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <p>No workflows found</p>
                    <Link to="/workflow/new">
                      <Button variant="outline" size="sm" className="mt-2">
                        Create Your First Workflow
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
              <div className="mt-4">
                <Link to="/workflows">
                  <Button variant="outline" className="w-full">
                    View All Workflows
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="bg-gradient-card border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Performance Chart
              </CardTitle>
              <CardDescription>
                P&L over the last 30 days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboardData.performanceData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      className="text-xs fill-muted-foreground"
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="value" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                      activeDot={{ r: 6, stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card className="bg-gradient-card border-border">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Get started with common tasks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <Link to="/workflow/new">
                <Button variant="outline" className="w-full h-auto p-4 flex flex-col gap-2">
                  <Plus className="h-6 w-6" />
                  <span>Create Workflow</span>
                </Button>
              </Link>
              <Link to="/projects">
                <Button variant="outline" className="w-full h-auto p-4 flex flex-col gap-2">
                  <Activity className="h-6 w-6" />
                  <span>Manage Projects</span>
                </Button>
              </Link>
              <Button variant="outline" className="w-full h-auto p-4 flex flex-col gap-2">
                <BarChart3 className="h-6 w-6" />
                <span>View Analytics</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Dashboard;