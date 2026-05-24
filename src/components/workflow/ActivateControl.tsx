import { AnimatePresence, motion } from "framer-motion";
import { Play, Square } from "lucide-react";

type ActivateControlProps = {
  isActive: boolean;
  loading: boolean;
  onToggle: () => void;
};

export const ActivateControl = ({
  isActive,
  loading,
  onToggle,
}: ActivateControlProps) => {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {isActive ? (
        <motion.button
          key="active"
          type="button"
          onClick={onToggle}
          disabled={loading}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-11 items-center rounded-full border border-border bg-card/90 text-foreground shadow-lg backdrop-blur transition-all duration-200 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          <span className="flex items-center gap-2 px-4">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-success" />
            <span className="text-sm font-medium">Live</span>
          </span>
          <span className="h-6 border-l border-border" />
          <span className="mx-2 flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors duration-200 hover:bg-destructive/90">
            <Square className="h-3.5 w-3.5 fill-current" />
          </span>
        </motion.button>
      ) : (
        <motion.button
          key="inactive"
          type="button"
          onClick={onToggle}
          disabled={loading}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-success to-success/80 px-6 text-sm font-medium text-success-foreground shadow-[0_8px_30px_-8px_hsl(var(--success)/0.6)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_10px_36px_-8px_hsl(var(--success)/0.75)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
        >
          <Play className="h-4 w-4" />
          Activate
        </motion.button>
      )}
    </AnimatePresence>
  );
};
