/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 * AGPL-3.0-only
 */

import React from "react";
import { motion } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { workflowTemplates, type TemplateId } from "@/templates/workflows";

interface TemplateChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (templateId: TemplateId) => void;
}

export const TemplateChooserDialog: React.FC<TemplateChooserDialogProps> = ({
  open,
  onOpenChange,
  onSelect,
}) => {
  const templates = [
    workflowTemplates.backtest,
    workflowTemplates.stream,
    workflowTemplates.custom,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a starting point</DialogTitle>
          <DialogDescription>
            Pick a template to seed your new workflow. You can edit everything afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {templates.map((tpl) => (
            <motion.button
              key={tpl.id}
              type="button"
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                onSelect(tpl.id);
                onOpenChange(false);
              }}
              className="text-left rounded-lg border border-border bg-card hover:bg-accent hover:text-accent-foreground hover:border-primary/40 hover:shadow-card transition-all p-5 flex flex-col gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                <img src={tpl.icon} alt="" className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-foreground">{tpl.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{tpl.description}</p>
              </div>
              <div className="text-xs text-muted-foreground mt-auto pt-2">
                {tpl.nodes.length} {tpl.nodes.length === 1 ? "node" : "nodes"}
              </div>
            </motion.button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
