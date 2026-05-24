import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Square, Zap } from "lucide-react";

type ExecuteAllControlProps = {
  isExecuting: boolean;
  disabled: boolean;
  onExecute: () => void;
  onStop: () => void;
};

export const ExecuteAllControl = ({
  isExecuting,
  disabled,
  onExecute,
  onStop,
}: ExecuteAllControlProps) => {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {isExecuting ? (
        <motion.div
          key="executing"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-11 items-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur"
        >
          <div className="flex items-center gap-2 px-4">
            <span className="relative flex h-5 w-5 items-center justify-center">
              <span className="absolute inset-0 rounded-full ring-2 ring-primary/40 animate-pulse" />
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </span>
            <span className="text-sm font-medium">Executing…</span>
          </div>
          <div className="h-6 border-l border-border" />
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop execution"
            className="mx-2 flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors duration-200 hover:bg-destructive/90"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        </motion.div>
      ) : (
        <motion.button
          key="idle"
          type="button"
          onClick={onExecute}
          disabled={disabled}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary/80 px-6 text-sm font-medium text-primary-foreground shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.6)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_10px_36px_-8px_hsl(var(--primary)/0.75)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          <Zap className="h-4 w-4" />
          Execute All
        </motion.button>
      )}
    </AnimatePresence>
  );
};
