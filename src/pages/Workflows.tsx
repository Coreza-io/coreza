import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  TrendingDown,
  ArrowLeft,
  Folder
} from "lucide-react";
import { motion } from "framer-motion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Workflow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  nodes: any;
  edges: any;
}

const Workflows = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const projectId = searchParams.get('project');

  // Load project info if projectId is provided
  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }

    const loadProject = async () => {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('id, name')
          .eq('id', projectId)
          .single();

        if (error) {
          console.error('Error loading project:', error);
          toast({
            title: "Error",
            description: "Failed to load project details",
            variant: "destructive",
          });
          return;
        }

        setProject(data);
      } catch (error) {
        console.error('Error loading project:', error);
      }
    };

    loadProject();
  }, [projectId, toast]);

  // Load workflows from database
  useEffect(() => {
    if (!user) return;
    
    const loadWorkflows = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('workflows')
          .select('*')
          .eq('user_id', user.id);

        // Filter by project if projectId is provided
        if (projectId) {
          query = query.eq('project_id', projectId);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) {
          console.error('Error loading workflows:', error);
          toast({
            title: "Error",
            description: "Failed to load workflows",
            variant: "destructive",
          });
        } else {
          setWorkflows(data || []);
        }
      } catch (error) {
        console.error('Error loading workflows:', error);
        toast({
          title: "Error", 
          description: "Failed to load workflows",
          variant: "destructive",
        });
      }
      setLoading(false);
    };

    loadWorkflows();
  }, [user, projectId, toast]);

  const handleToggleActive = async (workflowId: string, currentStatus: boolean) => {
    try {
      if (!currentStatus) {
        // Activating workflow - first check if backend is available
        const API_URL = "http://localhost:8000";
        
        // Check backend health first
        try {
          const healthCheck = await fetch(`${API_URL}/health`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          });
          
          if (!healthCheck.ok) {
            throw new Error("Backend server is not responding");
          }
        } catch (healthError: any) {
          console.error("Backend health check failed:", healthError);
          throw new Error("Backend server is not available. Please ensure your backend is running on http://localhost:8000");
        }

        // Backend is available, proceed with activation
        const res = await fetch(`${API_URL}/workflows/${workflowId}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerId: user?.id }),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(errorText);
        }

        // Update database to reflect activation
        const { error } = await supabase
          .from('workflows')
          .update({ is_active: true })
          .eq('id', workflowId);

        if (error) {
          throw error;
        }
      } else {
        // Pausing workflow - update database directly
        const { error } = await supabase
          .from('workflows')
          .update({ is_active: false })
          .eq('id', workflowId);

        if (error) {
          throw error;
        }
      }

      // Update local state
      setWorkflows(workflows.map(w => 
        w.id === workflowId ? { ...w, is_active: !currentStatus } : w
      ));

      toast({
        title: "Success",
        description: `Workflow ${!currentStatus ? 'activated' : 'paused'} successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Failed to ${!currentStatus ? 'activate' : 'pause'} workflow: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  const handleDeleteWorkflow = (workflow: Workflow) => {
    setSelectedWorkflow(workflow);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteWorkflow = async () => {
    if (!selectedWorkflow) return;

    try {
      setIsDeleting(true);

      const { error } = await supabase
        .from('workflows')
        .delete()
        .eq('id', selectedWorkflow.id);

      if (error) {
        throw error;
      }

      setWorkflows(workflows.filter(w => w.id !== selectedWorkflow.id));
      toast({
        title: "Success",
        description: "Workflow deleted successfully",
      });

      setIsDeleteDialogOpen(false);
      setSelectedWorkflow(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Failed to delete workflow: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredWorkflows = workflows.filter(workflow =>
    workflow.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusColor = (isActive: boolean) => {
    return isActive 
      ? 'bg-success text-success-foreground' 
      : 'bg-warning text-warning-foreground';
  };

  const getStatusIcon = (isActive: boolean) => {
    return isActive ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />;
  };

  const getStatusText = (isActive: boolean) => {
    return isActive ? 'active' : 'paused';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading workflows...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Project Context Header */}
      {project && (
        <div className="flex items-center gap-3 pb-2 border-b border-border">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigate('/projects')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Projects
          </Button>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Folder className="h-4 w-4" />
            <span className="text-sm">Project:</span>
            <span className="font-medium text-foreground">{project.name}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {project ? `${project.name} Workflows` : 'Workflows'}
          </h1>
          <p className="text-muted-foreground">
            {project 
              ? `Manage workflows for the ${project.name} project`
              : 'Manage your trading automation workflows'
            }
          </p>
        </div>
        <Link to={projectId ? `/workflow/new?project=${projectId}` : "/workflow/new"}>
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
                      <Badge className={`${getStatusColor(workflow.is_active)} flex items-center gap-1`}>
                        {getStatusIcon(workflow.is_active)}
                        {getStatusText(workflow.is_active)}
                      </Badge>
                    </div>
                    <CardDescription className="max-w-2xl">
                      Trading automation workflow
                    </CardDescription>
                    <p className="text-sm text-muted-foreground">
                      Nodes: {Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}
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
                      <DropdownMenuItem asChild>
                        <Link to={`/workflow/${workflow.id}`}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleActive(workflow.id, workflow.is_active)}>
                        {workflow.is_active ? (
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
                      <DropdownMenuItem 
                        className="text-destructive"
                        onClick={() => handleDeleteWorkflow(workflow)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      Nodes
                    </p>
                    <p className="font-medium">{Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Created
                    </p>
                    <p className="font-medium text-sm">
                      {new Date(workflow.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Last Updated</p>
                    <p className="font-medium text-sm">
                      {new Date(workflow.updated_at).toLocaleDateString()}
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
                    className={workflow.is_active ? 'text-warning' : 'text-success'}
                    onClick={() => handleToggleActive(workflow.id, workflow.is_active)}
                  >
                    {workflow.is_active ? (
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
            <Link to={projectId ? `/workflow/new?project=${projectId}` : "/workflow/new"}>
              <Button className="bg-gradient-primary">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Workflow
              </Button>
            </Link>
          )}
        </motion.div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedWorkflow?.name}"? This action cannot be undone.
              All workflow data and configurations will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setIsDeleteDialogOpen(false);
                setSelectedWorkflow(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteWorkflow}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Workflow"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Workflows;