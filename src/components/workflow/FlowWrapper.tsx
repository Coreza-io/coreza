import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  NodeTypes,
  EdgeTypes,
  ConnectionLineType,
  Node,
  Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { LoopNode, LoopNodeData } from './LoopNode';
import { LoopEdge } from './LoopEdge';

export function FlowWrapper({ initialNodes, initialEdges }: { initialNodes: Node[]; initialEdges: Edge[] }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [rawEdges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useReactFlow();

  const handleAddNode = useCallback((loopNodeId: string) => {
    const position = rf.getNode(loopNodeId)!.position;
    const newNode: Node = {
      id: `node_${Date.now()}`,
      type: 'default',
      position: { x: position.x + 200, y: position.y },
      data: { label: 'New Node' },
    };
    setNodes(ns => [...ns, newNode]);

    const newEdge: Edge = {
      id: `edge_${loopNodeId}_${newNode.id}`,
      source: loopNodeId,
      sourceHandle: 'done',
      target: newNode.id,
      type: 'smoothstep',
    };
    setEdges(es => [...es, newEdge]);
  }, [rf, setNodes, setEdges]);

  useEffect(() => {
    setEdges(es => {
      const loopNodeIds = nodes.filter(n => n.type === 'loop').map(n => n.id);
      const selfEdges = loopNodeIds.map(id => ({
        id: `self_${id}`,
        source: id,
        sourceHandle: 'done',
        target: id,
        targetHandle: 'in',
        type: 'loop-self',
      }));
      const all = [...es];
      for (const se of selfEdges) {
        if (!all.find(e => e.id === se.id)) all.push(se);
      }
      return all;
    });
  }, [nodes, setEdges]);

  const edges = rawEdges.map(e => {
    if (e.type === 'loop-self') {
      return {
        ...e,
        type: 'loop',
        style: { stroke: '#22c55e', strokeWidth: 3 },
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
        data: {},
      };
    }
    return e;
  });

  const nodeTypes: NodeTypes = {
    loop: (props) => (
      <LoopNode
        {...props as any}
        data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
      />
    ),
  };
  const edgeTypes: EdgeTypes = { loop: LoopEdge };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionLineType={ConnectionLineType.SmoothStep}
      fitView
    />
  );
}
