import React from "react";
import StreamingOutputPanel from "@/components/workflow/StreamingOutputPanel";

// Props strongly typed, with enhanced streaming support
export type OutputPanelProps = {
  nodeId?: string;
  data: any;
  isExpanded: boolean;
  position?: "left" | "right";
  pinned?: boolean;
  onSave?: (data: any) => void;
  onPinToggle?: () => void;
  isStreamingNode?: boolean;
};

// Enhanced OutputPanel that delegates to StreamingOutputPanel
const OutputPanel: React.FC<OutputPanelProps> = (props) => {
  // Check if this is a streaming node based on node type or category
  const isStreamingNode = props.isStreamingNode || 
    (typeof props.data?.definition?.category === 'string' && 
     ['AlpacaStream', 'Stream', 'Broker'].includes(props.data.definition.category));

  return (
    <StreamingOutputPanel 
      {...props}
      isStreamingNode={isStreamingNode}
    />
  );
};

export default OutputPanel;