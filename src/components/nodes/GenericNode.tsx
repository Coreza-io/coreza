import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent } from '@/components/ui/card';
import { 
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
} from 'lucide-react';

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
    Play
  };
  return icons[iconName as keyof typeof icons] || Database;
};

interface GenericNodeData {
  label?: string;
  config?: {
    name: string;
    icon: string;
    color: string;
    handles: { type: string; position: string; id: string }[];
  };
}

function GenericNode({ data }: NodeProps) {
  const nodeData = data as GenericNodeData;
  const config = nodeData?.config;
  const IconComponent = getIconComponent(config?.icon || 'Database');
  
  return (
    <Card className="min-w-[180px] shadow-node border-node">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-1.5 rounded-md bg-muted/50 ${config?.color || 'text-blue-500'}`}>
            <IconComponent className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium truncate">
            {config?.name || nodeData?.label || 'Node'}
          </span>
        </div>
        
        {/* Render handles based on config */}
        {config?.handles?.map((handle, index) => (
          <Handle
            key={`${handle.type}-${handle.id}-${index}`}
            type={handle.type as 'source' | 'target'}
            position={handle.position === 'left' ? Position.Left : 
                     handle.position === 'right' ? Position.Right :
                     handle.position === 'top' ? Position.Top : Position.Bottom}
            id={handle.id}
            className="!w-3 !h-3 !bg-primary/80 !border-2 !border-background"
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default memo(GenericNode);