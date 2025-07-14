import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Play
} from "lucide-react";
import { motion } from "framer-motion";
import { nodeManifest } from "@/nodes/manifest";

// Helper function to get icon component from string
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
    Search
  };
  return icons[iconName as keyof typeof icons] || Database;
};

export function NodePalette() {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredNodes = nodeManifest.filter(node =>
    node.config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.config.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.config.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categories = Array.from(new Set(nodeManifest.map(node => node.config.category)));

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

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

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {categories.map(category => {
          const categoryNodes = filteredNodes.filter(node => node.config.category === category);
          if (categoryNodes.length === 0) return null;

          return (
            <div key={category}>
              <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                {category}
              </h4>
              <div className="space-y-2">
                {categoryNodes.map((node, index) => (
                  <motion.div
                    key={node.config.node_type}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card
                      className="cursor-grab active:cursor-grabbing hover:shadow-card transition-all bg-gradient-card border-border group"
                      draggable
                      onDragStart={(e) => onDragStart(e, node.type)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-lg bg-muted/50 ${node.config.color} group-hover:shadow-glow transition-all`}>
                            {(() => {
                              // Handle SVG icons or Lucide icons
                              if (node.config.icon?.startsWith('/assets/')) {
                                return <img src={node.config.icon} alt={node.config.name} className="h-4 w-4" />;
                              } else {
                                const IconComponent = getIconComponent(node.config.icon);
                                return <IconComponent className="h-4 w-4" />;
                              }
                            })()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h5 className="font-medium text-sm mb-1">{node.config.name}</h5>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {node.config.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
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
            Drag and drop nodes onto the canvas to build your trading workflow. 
            Connect them by dragging from output to input handles.
          </p>
        </div>
      </div>
    </div>
  );
}