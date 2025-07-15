import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, Mail, MessageSquare, Webhook } from "lucide-react";

interface NotificationNodeData {
  label: string;
  type?: 'email' | 'sms' | 'webhook' | 'push';
  recipient?: string;
  message?: string;
}

export const NotificationNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as NotificationNodeData;
  const type = nodeData.type || 'email';
  const recipient = nodeData.recipient || 'user@example.com';

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return Mail;
      case 'sms': return MessageSquare;
      case 'webhook': return Webhook;
      case 'push': return Bell;
      default: return Bell;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'email': return 'text-blue-500';
      case 'sms': return 'text-green-500';
      case 'webhook': return 'text-purple-500';
      case 'push': return 'text-yellow-500';
      default: return 'text-gray-500';
    }
  };

  const TypeIcon = getTypeIcon(type);

  return (
    <Card className="min-w-[180px] bg-trading-node border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TypeIcon className={`h-4 w-4 ${getTypeColor(type)}`} />
          Notification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Badge variant="outline" className="text-xs capitalize">
          {type}
        </Badge>
        <div className="text-xs text-muted-foreground truncate">
          To: {recipient}
        </div>
        <div className="text-xs text-muted-foreground">
          {nodeData.message || 'Order executed successfully'}
        </div>
      </CardContent>
      
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-muted-foreground border-2 border-background"
        id="trigger"
      />
    </Card>
  );
});