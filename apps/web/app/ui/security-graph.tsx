"use client";

import type { GraphNode as HiveNode, GraphEdge as HiveEdge } from "@hiveswarm/contracts";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Box, Braces, CircleAlert, Cloud, Folder, Globe2, Network, Server, UserRound } from "lucide-react";
import { useMemo } from "react";

const kindIcons = {
  engagement: Network,
  host: Server,
  service: Box,
  website: Globe2,
  subdomain: Cloud,
  directory: Folder,
  endpoint: Braces,
  repository: Folder,
  identity: UserRound,
  finding: CircleAlert,
  agent: Network,
} as const;

type HiveFlowNode = Node<HiveNode, "hive">;

function GraphCard({ data, selected }: NodeProps<HiveFlowNode>) {
  const Icon = kindIcons[data.kind];
  return (
    <div className={`graph-node graph-node--${data.severity ?? data.kind}${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <span className="graph-node__icon"><Icon size={16} strokeWidth={1.5} aria-hidden="true" /></span>
      <span className="graph-node__copy">
        <strong>{data.label}</strong>
        <small>{data.subtitle ?? data.kind}</small>
      </span>
      {data.severity && data.severity !== "info" ? <span className={`graph-node__risk graph-node__risk--${data.severity}`} aria-label={`${data.severity} severity`} /> : null}
      <Handle type="source" position={Position.Right} className="graph-handle" />
    </div>
  );
}

const nodeTypes = { hive: GraphCard };

function positions(nodes: HiveNode[]): HiveFlowNode[] {
  const columns: Record<string, number> = { website: 0, host: 0, service: 1, directory: 1, endpoint: 2, repository: 0, subdomain: 1, identity: 2, finding: 3, agent: 0, engagement: 0 };
  const counts = new Map<number, number>();
  return nodes.map((node) => {
    const column = columns[node.kind] ?? 1;
    const row = counts.get(column) ?? 0;
    counts.set(column, row + 1);
    return { id: node.id, type: "hive", position: { x: column * 245 + 28, y: row * 112 + 46 + (column % 2) * 24 }, data: node };
  });
}

function flowEdges(edges: HiveEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.relationship,
    type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "var(--edge)" },
    style: { stroke: "var(--edge)", strokeWidth: 1.25 },
    labelStyle: { fill: "var(--text-tertiary)", fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: "var(--surface-canvas)", fillOpacity: 0.92 },
  }));
}

export function SecurityGraph({ nodes, edges, onSelect }: { nodes: HiveNode[]; edges: HiveEdge[]; onSelect: (node: HiveNode | null) => void }) {
  const graphNodes = useMemo(() => positions(nodes), [nodes]);
  const graphEdges = useMemo(() => flowEdges(edges), [edges]);
  return (
    <div className="graph" aria-label="Security asset and attack-path graph">
      <ReactFlow
        nodes={graphNodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.45}
        maxZoom={1.8}
        nodesDraggable
        nodesConnectable={false}
        onNodeClick={(_, node) => onSelect(node.data)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} position="bottom-left" aria-label="Graph zoom controls" />
        <MiniMap position="bottom-right" pannable zoomable nodeColor="var(--minimap-node)" maskColor="var(--minimap-mask)" aria-label="Graph overview" />
      </ReactFlow>
    </div>
  );
}
