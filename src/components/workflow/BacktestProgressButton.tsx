/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BacktestProgress } from "@/hooks/useBacktestProgress";

interface BacktestProgressButtonProps {
  progress: BacktestProgress | null;
  isRunning: boolean;
  isCompleted: boolean;
  onDismiss: () => void;
}

export const BacktestProgressButton: React.FC<BacktestProgressButtonProps> = ({
  progress,
  isRunning,
  isCompleted,
  onDismiss,
}) => {
  if (!progress) return null;

  const percent = progress.percent ?? 0;
  const isFailed = progress.status === "failed";
  const isDone = isCompleted && !isFailed;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: -4 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className={cn(
          "relative flex items-center gap-2.5 h-10 px-4 rounded-full border text-sm font-medium overflow-hidden select-none transition-colors duration-300",
          isDone && "border-success/40 bg-success/10 text-success",
          isFailed && "border-destructive/40 bg-destructive/10 text-destructive",
          isRunning && "border-primary/30 bg-card text-foreground",
        )}
      >
        {/* Background progress fill */}
        {isRunning && (
          <motion.div
            className="absolute inset-0 bg-primary/8 origin-left"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: percent / 100 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        )}

        {/* Icon */}
        <div className="relative z-10 flex items-center">
          {isDone ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 20 }}
            >
              <CheckCircle2 className="h-4 w-4" />
            </motion.div>
          ) : isFailed ? (
            <XCircle className="h-4 w-4" />
          ) : (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Activity className="h-4 w-4 text-primary" />
            </motion.div>
          )}
        </div>

        {/* Label */}
        <span className="relative z-10 whitespace-nowrap text-xs">
          {isDone
            ? "Backtest Complete"
            : isFailed
              ? "Backtest Failed"
              : `Backtesting… ${percent}%`}
        </span>

        {/* Bar stats */}
        {isRunning && progress.totalBars > 0 && (
          <span className="relative z-10 text-[10px] text-muted-foreground tabular-nums">
            {progress.barsProcessed.toLocaleString()}/{progress.totalBars.toLocaleString()}
          </span>
        )}

        {/* Progress ring for running state */}
        {isRunning && (
          <svg className="relative z-10 h-5 w-5 -rotate-90" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted/30"
            />
            <motion.circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-primary"
              strokeDasharray={50.26}
              animate={{ strokeDashoffset: 50.26 - (50.26 * percent) / 100 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </svg>
        )}

        {/* Dismiss button */}
        {(isDone || isFailed) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="relative z-10 ml-0.5 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
