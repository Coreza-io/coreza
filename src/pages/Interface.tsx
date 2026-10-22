import { lazy } from "react";
import { RouteBoundary } from "@/components/common/RouteBoundary";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
const Dashboard = lazy(() => import("./Dashboard"));
const Projects = lazy(() => import("./Projects"));
const Workflows = lazy(() => import("./Workflows"));
const WorkflowEditor = lazy(() => import("./WorkflowEditor"));
const Profile = lazy(() => import("./Profile"));
const Settings = lazy(() => import("./Settings"));
const MarketSubscriptions = lazy(() => import("./MarketSubscriptions"));
const Backtests = lazy(() => import("./Backtests"));
const BacktestResults = lazy(() => import("./BacktestResults"));
const LiveStrategies = lazy(() => import("./LiveStrategies"));
const LiveStrategyDetail = lazy(() => import("./LiveStrategyDetail"));

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
              <Route index element={<RouteBoundary><Dashboard /></RouteBoundary>} />
              <Route path="projects" element={<RouteBoundary><Projects /></RouteBoundary>} />
              <Route path="workflows" element={<RouteBoundary><Workflows /></RouteBoundary>} />
              <Route path="workflow/new" element={<RouteBoundary><WorkflowEditor /></RouteBoundary>} />
              <Route path="workflow/:id" element={<RouteBoundary><WorkflowEditor /></RouteBoundary>} />
              <Route path="backtests" element={<RouteBoundary><Backtests /></RouteBoundary>} />
              <Route path="backtests/:id" element={<RouteBoundary><BacktestResults /></RouteBoundary>} />
              <Route path="live" element={<RouteBoundary><LiveStrategies /></RouteBoundary>} />
              <Route path="live/:id" element={<RouteBoundary><LiveStrategyDetail /></RouteBoundary>} />
              <Route path="profile" element={<RouteBoundary><Profile /></RouteBoundary>} />
              <Route path="settings" element={<RouteBoundary><Settings /></RouteBoundary>} />
              <Route path="market-subscriptions" element={<RouteBoundary><MarketSubscriptions /></RouteBoundary>} />
            </Routes>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Interface;
