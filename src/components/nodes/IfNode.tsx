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
}

interface IfNodeData {
  conditions: Condition[];
  logicalOp: string;
  expanded?: boolean;
}

const IfNode: React.FC<{ data: IfNodeData; selected?: boolean }> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const { setNodes } = useReactFlow();
  
  const [isExpanded, setIsExpanded] = useState(data.expanded || false);
  const [conditions, setConditions] = useState<Condition[]>(
    data.conditions || [{ left: "", operator: "===", right: "" }]
  );
  const [logicalOp, setLogicalOp] = useState(data.logicalOp || "AND");

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
                logicalOp,
                expanded: isExpanded,
              },
            }
          : n
      )
    );
  }, [nodeId, conditions, logicalOp, isExpanded, setNodes]);

  const addCondition = () => {
    const newConditions = [...conditions, { left: "", operator: "===", right: "" }];
    setConditions(newConditions);
    updateNodeData();
  };

  const removeCondition = (index: number) => {
    if (conditions.length > 1) {
      const newConditions = conditions.filter((_, i) => i !== index);
      setConditions(newConditions);
      updateNodeData();
    }
  };

  const updateCondition = (index: number, field: keyof Condition, value: string) => {
    const newConditions = [...conditions];
    newConditions[index] = { ...newConditions[index], [field]: value };
    setConditions(newConditions);
    updateNodeData();
  };

  const handleExpand = () => {
    setIsExpanded(true);
    updateNodeData();
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    updateNodeData();
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
                <img src="/assets/icons/if.svg" className="w-6 h-6" alt="if icon" />
                If Condition
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
          
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {conditions.map((condition, index) => (
                <div key={index} className="border rounded p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium">Condition {index + 1}</span>
                    {conditions.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCondition(index)}
                        className="h-6 w-6 p-0"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Left Value</Label>
                      <Input
                        value={condition.left}
                        placeholder="{{ $json.value }}"
                        onChange={(e) => updateCondition(index, 'left', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    
                    <div>
                      <Label className="text-xs">Operator</Label>
                      <Select
                        value={condition.operator}
                        onValueChange={(val) => updateCondition(index, 'operator', val)}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operators.map((op) => (
                            <SelectItem key={op.value} value={op.value}>
                              {op.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Right Value</Label>
                      <Input
                        value={condition.right}
                        placeholder="100"
                        onChange={(e) => updateCondition(index, 'right', e.target.value)}
                        className="text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {conditions.length > 1 && (
              <div>
                <Label className="text-xs">Logical Operator</Label>
                <Select value={logicalOp} onValueChange={setLogicalOp}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {logicalOperators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={addCondition}
              className="w-full"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Condition
            </Button>

            <Button
              type="submit"
              className="w-full bg-success hover:bg-success/90 text-success-foreground"
            >
              Run
            </Button>
          </CardContent>
        </>
      )}
    </Card>
  );
};

export default IfNode;