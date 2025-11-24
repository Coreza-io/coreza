import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import Dashboard from "./Dashboard";
import Projects from "./Projects";
import Workflows from "./Workflows";
import WorkflowEditor from "./WorkflowEditor";
import Profile from "./Profile";
import Settings from "./Settings";

const Interface = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Check if current path is a workflow editor page
  const isWorkflowEditorPage = location.pathname.includes('/workflow/');

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to login
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          {!isWorkflowEditorPage && <Header />}
          <main className={`flex-1 ${!isWorkflowEditorPage ? 'p-6' : ''}`}>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="workflow/new" element={<WorkflowEditor />} />
              <Route path="workflow/:id" element={<WorkflowEditor />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Interface;
