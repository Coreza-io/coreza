import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Play,
  Pause,
  Activity,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown
} from "lucide-react";
import { motion } from "framer-motion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const Workflows = () => {
  const [searchQuery, setSearchQuery] = useState("");

  // Mock data for demonstration
  const workflows = [
    {
      id: 1,
      name: "BTC Mean Reversion",
      description: "Buy low, sell high strategy for Bitcoin with RSI signals",
      status: "active",
      project: "Mean Reversion Bots",
      createdAt: "2024-01-15",
      lastRun: "2024-01-20",
      pnl: 234.56,
      trades: 45
    },
    {
      id: 2,
      name: "ETH Grid Strategy",
      description: "Grid trading system for Ethereum with 1% intervals",
      status: "paused",
      project: "Grid Trading Strategies",
      createdAt: "2024-01-12",
      lastRun: "2024-01-19",
      pnl: -45.23,
      trades: 23
    },
    {
      id: 3,
      name: "SOL Scalping Bot",
      description: "High-frequency scalping for Solana with volume analysis",
      status: "active",
      project: "Scalping Algorithms",
      createdAt: "2024-01-10",
      lastRun: "2024-01-20",
      pnl: 567.89,
      trades: 127
    },
    {
      id: 4,
      name: "USDC-DAI Arbitrage",
      description: "Cross-exchange arbitrage for stable coin pairs",
      status: "draft",
      project: "DeFi Yield Farming",
      createdAt: "2024-01-08",
      lastRun: null,
      pnl: 0,
      trades: 0
    },
    {
      id: 5,
      name: "ADA Momentum Bot",
      description: "Momentum-based trading strategy for Cardano",
      status: "error",
      project: "Mean Reversion Bots",
      createdAt: "2024-01-05",
      lastRun: "2024-01-18",
      pnl: -123.45,
      trades: 12
    }
  ];

  const filteredWorkflows = workflows.filter(workflow =>
    workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    workflow.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    workflow.project.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-success text-success-foreground';
      case 'paused': return 'bg-warning text-warning-foreground';
      case 'error': return 'bg-destructive text-destructive-foreground';
      case 'draft': return 'bg-muted text-muted-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active': return <Play className="h-3 w-3" />;
      case 'paused': return <Pause className="h-3 w-3" />;
      case 'error': return <TrendingDown className="h-3 w-3" />;
      default: return <Activity className="h-3 w-3" />;
    }
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
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
          <h1 className="text-3xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">
            Manage your trading automation workflows
          </p>
        </div>
        <Link to="/workflow/new">
          <Button className="bg-gradient-primary hover:shadow-glow">
            <Plus className="h-4 w-4 mr-2" />
            New Workflow
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="space-y-4"
      >
        {filteredWorkflows.map((workflow) => (
          <motion.div key={workflow.id} variants={item}>
            <Card className="bg-gradient-card border-border hover:shadow-card transition-all group">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-xl">{workflow.name}</CardTitle>
                      <Badge className={`${getStatusColor(workflow.status)} flex items-center gap-1`}>
                        {getStatusIcon(workflow.status)}
                        {workflow.status}
                      </Badge>
                    </div>
                    <CardDescription className="max-w-2xl">
                      {workflow.description}
                    </CardDescription>
                    <p className="text-sm text-muted-foreground">
                      Project: {workflow.project}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-popover border-border">
                      <DropdownMenuItem>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        {workflow.status === 'active' ? (
                          <>
                            <Pause className="h-4 w-4 mr-2" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Activate
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      P&L
                    </p>
                    <p className={`font-medium ${
                      workflow.pnl >= 0 ? 'text-success' : 'text-destructive'
                    }`}>
                      {workflow.pnl >= 0 ? '+' : ''}${workflow.pnl.toFixed(2)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      Trades
                    </p>
                    <p className="font-medium">{workflow.trades}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Created
                    </p>
                    <p className="font-medium text-sm">
                      {new Date(workflow.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Last Run</p>
                    <p className="font-medium text-sm">
                      {workflow.lastRun ? new Date(workflow.lastRun).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <Link to={`/workflow/${workflow.id}`}>
                    <Button variant="outline" size="sm">
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Workflow
                    </Button>
                  </Link>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className={workflow.status === 'active' ? 'text-warning' : 'text-success'}
                  >
                    {workflow.status === 'active' ? (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Activate
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {filteredWorkflows.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12"
        >
          <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No workflows found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery ? "Try adjusting your search query" : "Create your first workflow to start trading"}
          </p>
          {!searchQuery && (
            <Link to="/workflow/new">
              <Button className="bg-gradient-primary">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Workflow
              </Button>
            </Link>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default Workflows;