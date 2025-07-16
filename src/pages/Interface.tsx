import { Routes, Route } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import Dashboard from "./Dashboard";
import Projects from "./Projects";
import Workflows from "./Workflows";
import WorkflowEditor from "./WorkflowEditor";
import Profile from "./Profile";
import Settings from "./Settings";

const Interface = () => {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/workflow/:id" element={<WorkflowEditor />} />
              <Route path="/workflow/new" element={<WorkflowEditor />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Interface;