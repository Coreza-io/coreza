/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/apiClient";

export interface BacktestProgress {
  backtestId: string;
  percent: number;
  barsProcessed: number;
  totalBars: number;
  status: string;
  completed: boolean;
  updatedAt?: string;
}

export const useBacktestProgress = (
  workflowId: string | null,
) => {
  const { user, session } = useAuth();
  const [activeBacktestId, setActiveBacktestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeBacktestIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeBacktestIdRef.current = activeBacktestId;
  }, [activeBacktestId]);

  // Watch for new backtests created for this workflow via realtime
  useEffect(() => {
    if (!workflowId || !user) return;

    const channel = supabase
      .channel(`backtest-progress-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "backtests",
          filter: `workflow_id=eq.${workflowId}`,
        },
        (payload) => {
          const bt = payload.new as any;
          if (bt.user_id === user.id && (bt.status === "running" || bt.status === "pending")) {
            activeBacktestIdRef.current = bt.id;
            setActiveBacktestId(bt.id);
            setIsCompleted(false);
            setProgress({
              backtestId: bt.id,
              percent: 0,
              barsProcessed: 0,
              totalBars: 0,
              status: bt.status,
              completed: false,
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "backtests",
          filter: `workflow_id=eq.${workflowId}`,
        },
        (payload) => {
          const bt = payload.new as any;
          if (bt.id === activeBacktestIdRef.current && (bt.status === "completed" || bt.status === "failed")) {
            setProgress((prev) => prev ? { ...prev, percent: 100, completed: true, status: bt.status } : null);
            setIsCompleted(true);
          }
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [workflowId, user]);

  // Poll progress endpoint
  const pollProgress = useCallback(async () => {
    if (!activeBacktestId || !session?.access_token) return;
    try {
      const res = await apiClient.get(
        `/backtest/${activeBacktestId}/progress`,
        session.access_token,
      );
      if (res.ok) {
        const data = await res.json();
        setProgress(data);
        if (data.completed || data.status === "completed" || data.status === "failed") {
          setIsCompleted(true);
        }
      }
    } catch {
      // Silently ignore polling errors
    }
  }, [activeBacktestId, session?.access_token]);

  useEffect(() => {
    if (!activeBacktestId || isCompleted) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    pollProgress();
    pollRef.current = setInterval(pollProgress, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeBacktestId, isCompleted, pollProgress]);

  // Auto-dismiss after completion
  useEffect(() => {
    if (isCompleted) {
      dismissRef.current = setTimeout(() => {
        activeBacktestIdRef.current = null;
        setActiveBacktestId(null);
        setProgress(null);
        setIsCompleted(false);
      }, 4000);
    }

    return () => {
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, [isCompleted]);

  const dismiss = useCallback(() => {
    activeBacktestIdRef.current = null;
    setActiveBacktestId(null);
    setProgress(null);
    setIsCompleted(false);
    if (pollRef.current) clearInterval(pollRef.current);
    if (dismissRef.current) clearTimeout(dismissRef.current);
  }, []);

  const startTracking = useCallback((backtestId: string) => {
    if (!backtestId) return;

    activeBacktestIdRef.current = backtestId;
    setActiveBacktestId(backtestId);
    setIsCompleted(false);
    setProgress({
      backtestId,
      percent: 0,
      barsProcessed: 0,
      totalBars: 0,
      status: "running",
      completed: false,
    });
  }, []);

  return {
    activeBacktestId,
    progress,
    isRunning: !!activeBacktestId && !isCompleted,
    isCompleted,
    startTracking,
    dismiss,
  };
};
