import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  PlayCircle, 
  Plus,
  BarChart3
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const Dashboard = () => {
  // Mock data for demonstration
  const stats = [
    {
      title: "Active Workflows",
      value: "12",
      change: "+2 this week",
      icon: Activity,
      trend: "up"
    },
    {
      title: "Total P&L",
      value: "$4,234.56",
      change: "+12.3% this month",
      icon: DollarSign,
      trend: "up"
    },
    {
      title: "Success Rate",
      value: "87.4%",
      change: "+3.2% vs last month",
      icon: TrendingUp,
      trend: "up"
    },
    {
      title: "Active Trades",
      value: "8",
      change: "2 pending orders",
      icon: PlayCircle,
      trend: "neutral"
    }
  ];

  const recentWorkflows = [
    { name: "BTC Mean Reversion", status: "active", pnl: "+$234.56" },
    { name: "ETH Grid Strategy", status: "paused", pnl: "-$45.23" },
    { name: "SOL Scalping Bot", status: "active", pnl: "+$567.89" },
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's your trading overview.
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
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {stat.trend === "up" && <TrendingUp className="h-3 w-3 text-success" />}
                  {stat.trend === "down" && <TrendingDown className="h-3 w-3 text-destructive" />}
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
                {recentWorkflows.map((workflow, index) => (
                  <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium">{workflow.name}</p>
                      <p className="text-sm text-muted-foreground capitalize">
                        Status: {workflow.status}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-medium ${
                        workflow.pnl.startsWith('+') ? 'text-success' : 'text-destructive'
                      }`}>
                        {workflow.pnl}
                      </p>
                    </div>
                  </div>
                ))}
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
              <div className="h-[200px] flex items-center justify-center bg-muted/20 rounded-lg">
                <p className="text-muted-foreground">
                  Chart visualization will be implemented with Recharts
                </p>
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