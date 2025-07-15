import React, { useState, useCallback } from 'react';
import { Handle, Position, useNodeId, useNodes, useEdges, useReactFlow } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { X, Plus, Minus } from "lucide-react";

interface Condition {
  left: string;
  operator: string;
  right: string;
  logicalOp?: string; // AND/OR for this condition (not applicable to first condition)
}

interface IfNodeData {
  conditions: Condition[];
  expanded?: boolean;
}

const IfNode: React.FC<{ data: IfNodeData; selected?: boolean }> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const { setNodes } = useReactFlow();
  
  const [isExpanded, setIsExpanded] = useState(data.expanded || false);
  const [conditions, setConditions] = useState<Condition[]>(
    data.conditions || [{ left: "", operator: "===", right: "" }]
  );

  const operators = [
    { label: "equals", value: "===" },
    { label: "not equals", value: "!==" },
    { label: "greater than", value: ">=" },
    { label: "less than", value: "=<" }
  ];

  const logicalOperators = [
    { label: "AND", value: "AND" },
    { label: "OR", value: "OR" }
  ];

  const updateNodeData = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                conditions,
                expanded: isExpanded,
              },
            }
          : n
      )
    );
  }, [nodeId, conditions, isExpanded, setNodes]);

  const addCondition = () => {
    const newConditions = [...conditions, { left: "", operator: "===", right: "", logicalOp: "AND" }];
    setConditions(newConditions);
    setTimeout(updateNodeData, 0);
  };

  const removeCondition = (index: number) => {
    if (conditions.length > 1) {
      const newConditions = conditions.filter((_, i) => i !== index);
      setConditions(newConditions);
      setTimeout(updateNodeData, 0);
    }
  };

  const updateCondition = (index: number, field: keyof Condition, value: string) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setConditions(newConditions);
    setTimeout(updateNodeData, 0);
  };

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(updateNodeData, 0);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    setTimeout(updateNodeData, 0);
  };

  return (
    <Card
      className={`
        relative shadow-card overflow-hidden transition-all duration-300 ease-in-out 
        bg-card border-2 hover:shadow-elevated rounded-lg
        ${isExpanded ? "" : "w-[150px] h-[100px] cursor-pointer group"}
        ${selected ? "border-primary shadow-glow" : "border-border"}
      `}
      onDoubleClick={!isExpanded ? handleExpand : undefined}
      style={{
        width: isExpanded ? 340 : 150,
        minHeight: isExpanded ? 340 : 100,
        height: isExpanded ? "auto" : 100,
      }}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-3 h-3 border-2 border-border bg-background hover:border-primary transition-colors"
        style={{ top: '50%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="true"
        className="w-3 h-3 border-2 border-border bg-success hover:border-primary transition-colors"
        style={{ top: '40%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="false"
        className="w-3 h-3 border-2 border-border bg-destructive hover:border-primary transition-colors"
        style={{ top: '60%' }}
      />

      {/* Collapsed View */}
      {!isExpanded && (
        <div className="flex flex-col items-center justify-center h-full p-4 select-none">
          <div className="text-muted-foreground mb-2">
            <img src="/assets/icons/if.svg" className="w-10 h-10" alt="if icon" />
          </div>
          <div className="font-semibold text-sm text-foreground text-center leading-tight">
            If
          </div>
        </div>
      )}

      {/* Expanded View */}
      {isExpanded && (
        <>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                Conditions
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCollapse}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {conditions.map((condition, index) => (
                <React.Fragment key={index}>
                  {/* Show AND/OR dropdown above condition (except for first condition) */}
                  {index > 0 && (
                    <div className="flex justify-center py-1">
                      <Select
                        value={condition.logicalOp || "AND"}
                        onValueChange={(val) => updateCondition(index, 'logicalOp', val)}
                      >
                        <SelectTrigger className="w-20 h-8 text-xs bg-background border border-border z-50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-background border border-border shadow-lg z-50">
                          {logicalOperators.map((op) => (
                            <SelectItem key={op.value} value={op.value} className="text-xs">
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  {/* Condition Row */}
                  <div className="flex items-center gap-2 p-2 border rounded">
                    <Input
                      value={condition.left}
                      placeholder="{{ $json.value }}"
                      onChange={(e) => updateCondition(index, 'left', e.target.value)}
                      className="flex-1 text-xs h-8"
                    />
                    
                    <Select
                      value={condition.operator}
                      onValueChange={(val) => updateCondition(index, 'operator', val)}
                    >
                      <SelectTrigger className="w-24 h-8 text-xs bg-background border border-border z-50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-background border border-border shadow-lg z-50">
                        {operators.map((op) => (
                          <SelectItem key={op.value} value={op.value} className="text-xs">
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    <Input
                      value={condition.right}
                      placeholder="100"
                      onChange={(e) => updateCondition(index, 'right', e.target.value)}
                      className="flex-1 text-xs h-8"
                    />
                    
                    {conditions.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCondition(index)}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </React.Fragment>
              ))}
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={addCondition}
              className="w-full text-xs h-8"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Condition
            </Button>

            <Button
              type="submit"
              className="w-full bg-foreground text-background hover:bg-foreground/90 text-xs h-9"
            >
              Execute
            </Button>
          </CardContent>
        </>
      )}
    </Card>
  );
};

export default IfNode;