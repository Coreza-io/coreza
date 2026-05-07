/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Search,
  Database,
  TrendingUp,
  GitBranch,
  ShoppingCart,
  Bell,
  BarChart3,
  Zap,
  DollarSign,
  Mail,
  Brain,
  MessageSquare,
  Calendar,
  Activity,
  Bot,
  Target,
  Play,
  Globe,
  ChevronRight,
  ChevronDown,
  Wrench,
  Radio,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { nodeManifest } from "@/nodes/manifest";
import { getNodeIcon } from "@/utils/nodeSchemaHelpers";

const getIconComponent = (iconName: string) => {
  const icons = {
    Database,
    TrendingUp,
    GitBranch,
    ShoppingCart,
    Bell,
    BarChart3,
    Zap,
    DollarSign,
    Mail,
    Brain,
    MessageSquare,
    Calendar,
    Activity,
    Bot,
    Target,
    Play,
    Search,
    Globe,
  };
  return icons[iconName as keyof typeof icons] || Database;
};

const getCategoryIcon = (category: string) => {
  const map: Record<string, React.ElementType> = {
    Broker: DollarSign,
    Indicators: TrendingUp,
    ControlFlow: GitBranch,
    Utility: Wrench,
    Communication: Mail,
    DataSource: Database,
    LLM: Brain,
    AIAgent: Bot,
    Streaming: Radio,
    Backtest: BarChart3,
  };
  return map[category] || Layers;
};

// Static — nodeManifest never changes after init
const allNodeEntries = Object.entries(nodeManifest);
const categories = Array.from(
  new Set(Object.values(nodeManifest).map((node) => (node as any).category).filter(Boolean))
);

const MAX_STAGGER_INDEX = 10;

interface NodePaletteProps {
  onNodeClick?: (nodeType: string) => void;
}

export function NodePalette({ onNodeClick }: NodePaletteProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const isSearching = searchQuery.trim().length > 0;

  const filteredNodes = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return allNodeEntries.filter(([_, node]) =>
      node.name.toLowerCase().includes(q) ||
      (node as any).description?.toLowerCase().includes(q) ||
      (node as any).category?.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const toggleCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const onDragStart = useCallback((event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h3 className="text-lg font-semibold mb-3">Node Palette</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex-1 p-4 space-y-1 overflow-y-auto">
        {categories.map((category) => {
          const categoryNodes = filteredNodes.filter(
            ([_, node]) => (node as any).category === category
          );
          if (categoryNodes.length === 0) return null;

          const isOpen = isSearching || expandedCategories.has(category);
          const CategoryIcon = getCategoryIcon(category);

          return (
            <div key={category}>
              <button
                onClick={() => !isSearching && toggleCategory(category)}
                className={`w-full flex items-center gap-2 py-2 px-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ${isSearching ? "cursor-default" : ""}`}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" />
                )}
                <CategoryIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{category}</span>
                <span className="text-xs text-muted-foreground/60">
                  {categoryNodes.length}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-1 pb-2 pl-2">
                      {categoryNodes.map(([nodeType, node], index) => (
                        <motion.div
                          key={nodeType}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(index, MAX_STAGGER_INDEX) * 0.03 }}
                        >
                          <Card
                            className="relative cursor-grab active:cursor-grabbing hover:shadow-card transition-all bg-gradient-card border-border group"
                            draggable
                            onDragStart={(e) => onDragStart(e, nodeType)}
                            onClick={() => onNodeClick?.(nodeType)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                <div
                                  className={`p-2 rounded-lg bg-muted/50 ${(node as any).color || ""} group-hover:shadow-glow transition-all`}
                                >
                                  {(() => {
                                    const iconPath = getNodeIcon(node);
                                    if (iconPath?.startsWith("/assets/")) {
                                      return (
                                        <img
                                          src={iconPath}
                                          alt={node.name}
                                          className="h-4 w-4"
                                          loading="eager"
                                          style={{ imageRendering: "auto" }}
                                        />
                                      );
                                    } else {
                                      const IconComponent = getIconComponent(
                                        iconPath || "Database"
                                      );
                                      return <IconComponent className="h-4 w-4" />;
                                    }
                                  })()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h5 className="font-medium text-sm mb-1">
                                    {node.name}
                                  </h5>
                                  <p className="text-xs text-muted-foreground line-clamp-2">
                                    {(node as any).description ||
                                      "No description available"}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {filteredNodes.length === 0 && (
          <div className="text-center py-8">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No nodes found</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try adjusting your search query
            </p>
          </div>
        )}

        <div className="mt-8 p-3 bg-muted/30 rounded-lg">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Quick Tip
          </h4>
          <p className="text-xs text-muted-foreground">
            Drag and drop nodes onto the canvas or click to add at center.
            Connect them by dragging from output to input handles.
          </p>
        </div>
      </div>
    </div>
  );
}
