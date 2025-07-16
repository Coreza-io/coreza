import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Dashboard = () => {
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState({
    activeWorkflows: 0,
    totalWorkflows: 0,
    recentWorkflows: [] as any[],
    performanceData: [] as any[]
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  // Check for user authentication
  useEffect(() => {
    const userEmail = localStorage.getItem('userEmail');
    const userId = localStorage.getItem('userId');
    const userName = localStorage.getItem('userName');
    
    if (userEmail && userId && userName) {
      setUser({ id: userId, email: userEmail, name: userName });
    } else {
      navigate('/login');
    }
  }, [navigate]);

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
        
        // Generate mock performance data for now (you can replace this with real data later)
        const performanceData = Array.from({ length: 30 }, (_, i) => ({
          date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: Math.floor(Math.random() * 1000) + 500
        }));

        setDashboardData({
          activeWorkflows: activeWorkflows.length,
          totalWorkflows: workflows?.length || 0,
          recentWorkflows: workflows?.slice(0, 3) || [],
          performanceData
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
      value: "N/A",
      change: "Coming soon",
      icon: TrendingUp,
      trend: "neutral" as const
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