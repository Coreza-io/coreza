/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import MarketSubscriptions from "./MarketSubscriptions";
import Backtests from "./Backtests";
import BacktestResults from "./BacktestResults";
import LiveStrategies from "./LiveStrategies";
import LiveStrategyDetail from "./LiveStrategyDetail";

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
        <div className="flex-1 flex flex-col relative">
          {isWorkflowEditorPage && (
            <div className="absolute top-4 left-4 z-30">
              <SidebarTrigger className="bg-card border border-border rounded-md hover:bg-muted" />
            </div>
          )}
          {!isWorkflowEditorPage && <Header />}
          <main className={`flex-1 ${!isWorkflowEditorPage ? 'p-6' : ''}`}>
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="workflows" element={<Workflows />} />
              <Route path="workflow/new" element={<WorkflowEditor />} />
              <Route path="workflow/:id" element={<WorkflowEditor />} />
              <Route path="backtests" element={<Backtests />} />
              <Route path="backtests/:id" element={<BacktestResults />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<Settings />} />
              <Route path="market-subscriptions" element={<MarketSubscriptions />} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Interface;
