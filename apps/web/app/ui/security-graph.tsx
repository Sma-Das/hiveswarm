"use client";

import type { AgentRun, Dashboard, Finding, GraphEdge as HiveEdge, GraphNode as HiveNode } from "@hiveswarm/contracts";
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
import { Bot, Box, Braces, CircleAlert, Cloud, Folder, Globe2, Network, Server, UserRound } from "lucide-react";
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
  agent: Bot,
} as const;

type GraphMode = "topology" | "swarm" | "scope" | "finding";
type HiveFlowNode = Node<HiveNode, "hive">;

function GraphCard({ data, selected }: NodeProps<HiveFlowNode>) {
  const Icon = kindIcons[data.kind];
  const active = ["running", "starting"].includes(data.status ?? "");
  return (
    <div className={`graph-node graph-node--${data.severity ?? data.kind} graph-node--state-${data.status ?? "observed"}${active ? " is-live" : ""}${selected ? " is-selected" : ""}`} aria-label={`${data.label}, ${data.status ?? data.kind}`}>
      <Handle type="target" position={Position.Left} className="graph-handle" />
      <span className="graph-node__icon"><Icon size={16} strokeWidth={1.5} aria-hidden="true" />{active ? <i className="graph-node__pulse" aria-hidden="true" /> : null}</span>
      <span className="graph-node__copy">
        <strong>{data.label}</strong>
        <small>{data.subtitle ?? data.kind}</small>
      </span>
      <span className={`graph-node__state graph-node__state--${data.status ?? "observed"}`} aria-hidden="true" />
      <Handle type="source" position={Position.Right} className="graph-handle" />
    </div>
  );
}

const nodeTypes = { hive: GraphCard };

function positions(nodes: HiveNode[], mode: GraphMode): HiveFlowNode[] {
  const topologyColumns: Record<string, number> = { engagement: 0, website: 0, host: 0, repository: 0, service: 1, directory: 1, subdomain: 1, endpoint: 2, identity: 2, agent: 2, finding: 3 };
  const counts = new Map<number, number>();
  return nodes.map((node) => {
    const depth = Number(node.metadata.depth ?? 0);
    const column = mode === "swarm" ? depth : mode === "scope" ? Number(node.metadata.column ?? 0) : topologyColumns[node.kind] ?? 1;
    const row = counts.get(column) ?? 0;
    counts.set(column, row + 1);
    const gapX = mode === "swarm" ? 260 : 245;
    const gapY = mode === "swarm" ? 120 : 112;
    return { id: node.id, type: "hive", position: { x: column * gapX + 28, y: row * gapY + 42 + (column % 2) * 24 }, data: node };
  });
}

function flowEdges(edges: HiveEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.relationship,
    type: "smoothstep",
    animated: edge.metadata.animated === true,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.metadata.color === "danger" ? "var(--danger)" : edge.metadata.color === "warning" ? "var(--warning)" : "var(--edge)" },
    style: { stroke: edge.metadata.color === "danger" ? "var(--danger)" : edge.metadata.color === "warning" ? "var(--warning)" : "var(--edge)", strokeWidth: edge.metadata.animated ? 1.75 : 1.25 },
    labelStyle: { fill: "var(--text-tertiary)", fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: "var(--surface-canvas)", fillOpacity: 0.92 },
  }));
}

function GraphCanvas({ nodes, edges, mode, ariaLabel, onSelect, compact = false }: {
  nodes: HiveNode[];
  edges: HiveEdge[];
  mode: GraphMode;
  ariaLabel: string;
  onSelect: (node: HiveNode | null) => void;
  compact?: boolean;
}) {
  const graphNodes = useMemo(() => positions(nodes, mode), [nodes, mode]);
  const graphEdges = useMemo(() => flowEdges(edges), [edges]);
  return (
    <div className={`graph graph--${mode}`} aria-label={ariaLabel}>
      <ReactFlow nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: compact ? 0.28 : 0.18 }} minZoom={0.35} maxZoom={1.8} nodesDraggable nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.data)} onPaneClick={() => onSelect(null)} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--graph-dot)" />
        <Controls showInteractive={false} position="bottom-left" aria-label="Graph zoom controls" />
        {!compact ? <MiniMap position="bottom-right" pannable zoomable nodeColor="#9aa4b2" maskColor="rgba(9, 11, 15, 0.76)" style={{ background: "#171a20" }} aria-label="Graph overview" /> : null}
      </ReactFlow>
    </div>
  );
}

export function SecurityGraph({ nodes, edges, onSelect }: { nodes: HiveNode[]; edges: HiveEdge[]; onSelect: (node: HiveNode | null) => void }) {
  return <GraphCanvas nodes={nodes} edges={edges} mode="topology" ariaLabel="Infrastructure, application, and vulnerability topology" onSelect={onSelect} />;
}

function agentNode(agent: AgentRun): HiveNode {
  return {
    id: agent.id,
    kind: "agent",
    label: agent.agentName,
    subtitle: `${agent.lifecycle} · depth ${agent.depth}`,
    status: agent.status,
    metadata: { agentRunId: agent.id, depth: agent.depth, lifecycle: agent.lifecycle },
    discoveredBy: agent.parentAgentRunId ? "Parent agent" : "HiveSwarm",
    createdAt: agent.startedAt ?? new Date().toISOString(),
  };
}

export function SwarmGraph({ agents, findings, onSelectAgent, onSelectFinding }: {
  agents: AgentRun[];
  findings: Finding[];
  onSelectAgent: (agentRunId: string) => void;
  onSelectFinding: (finding: Finding) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const nodes: HiveNode[] = agents.map(agentNode);
    const edges: HiveEdge[] = agents.flatMap((agent) => agent.parentAgentRunId ? [{
      id: `agent-edge-${agent.id}`,
      source: agent.parentAgentRunId,
      target: agent.id,
      relationship: agent.depth === 1 ? "delegated" : "spawned",
      metadata: { animated: ["running", "starting"].includes(agent.status), color: agent.status === "failed" ? "danger" : agent.status === "waiting_approval" ? "warning" : "default" },
    }] : []);
    for (const finding of findings) {
      const owner = agents.find((agent) => agent.agentName.toLowerCase() === finding.discoveredBy.toLowerCase() || agent.agentId.toLowerCase() === finding.discoveredBy.toLowerCase()) ?? agents[0];
      if (!owner) continue;
      nodes.push({ id: `swarm-${finding.id}`, kind: "finding", label: finding.title, subtitle: `${finding.severity} · ${finding.assetLabel}`, severity: finding.severity, status: finding.status, metadata: { findingId: finding.id, depth: Math.min(5, owner.depth + 1) }, discoveredBy: finding.discoveredBy, createdAt: finding.createdAt });
      edges.push({ id: `finding-edge-${finding.id}`, source: owner.id, target: `swarm-${finding.id}`, relationship: "raised", metadata: { color: finding.severity === "critical" || finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warning" : "default" } });
    }
    return { nodes, edges };
  }, [agents, findings]);
  return <GraphCanvas nodes={nodes} edges={edges} mode="swarm" ariaLabel="Orchestrator, recursive subagents, statuses, and raised findings" onSelect={(node) => {
    if (!node) return;
    const findingId = node.metadata.findingId;
    if (typeof findingId === "string") {
      const finding = findings.find((item) => item.id === findingId);
      if (finding) onSelectFinding(finding);
      return;
    }
    const agentRunId = node.metadata.agentRunId;
    if (typeof agentRunId === "string") onSelectAgent(agentRunId);
  }} />;
}

export function ScopeGraph({ dashboard, onSelect }: { dashboard: Dashboard; onSelect: (node: HiveNode | null) => void }) {
  const { nodes, edges } = useMemo(() => {
    const root: HiveNode = { id: `scope-root-${dashboard.engagement.id}`, kind: "engagement", label: dashboard.engagement.name, subtitle: dashboard.engagement.target, status: dashboard.engagement.status, metadata: { column: 0 }, discoveredBy: "Human", createdAt: dashboard.engagement.startedAt };
    const nodes: HiveNode[] = [root];
    const edges: HiveEdge[] = [];
    for (const rule of dashboard.engagement.scopeRules) {
      const kind: HiveNode["kind"] = rule.kind === "repository" ? "repository" : rule.kind === "url-prefix" ? "endpoint" : rule.kind === "host" || rule.kind === "cidr" ? "host" : "subdomain";
      nodes.push({ id: `scope-${rule.id}`, kind, label: rule.value, subtitle: `${rule.action} · ${rule.kind}`, status: rule.action === "allow" ? "allowed" : "denied", metadata: { scopeRuleId: rule.id, action: rule.action, column: 1 }, discoveredBy: "Human", createdAt: dashboard.engagement.startedAt });
      edges.push({ id: `scope-edge-${rule.id}`, source: root.id, target: `scope-${rule.id}`, relationship: rule.action === "allow" ? "allows" : "denies", metadata: { color: rule.action === "deny" ? "danger" : "default" } });
    }
    for (const candidate of dashboard.graph.nodes.filter((node) => node.status === "scope-review")) {
      nodes.push({ ...candidate, id: `scope-review-${candidate.id}`, metadata: { ...candidate.metadata, originalNodeId: candidate.id, column: 2 } });
      edges.push({ id: `scope-review-edge-${candidate.id}`, source: root.id, target: `scope-review-${candidate.id}`, relationship: "requests", metadata: { color: "warning", animated: true } });
    }
    return { nodes, edges };
  }, [dashboard]);
  return <GraphCanvas nodes={nodes} edges={edges} mode="scope" ariaLabel="Allowed, denied, and proposed scope boundaries" onSelect={onSelect} />;
}

export function FindingPathGraph({ dashboard, finding, onSelect }: { dashboard: Dashboard; finding: Finding; onSelect: (node: HiveNode | null) => void }) {
  const { nodes, edges } = useMemo(() => {
    const targets = dashboard.graph.nodes.filter((node) => node.metadata.findingId === finding.id);
    if (!targets.length) {
      const asset: HiveNode = { id: `finding-asset-${finding.id}`, kind: "endpoint", label: finding.assetLabel, subtitle: "Affected asset", status: "observed", metadata: {}, discoveredBy: finding.discoveredBy, createdAt: finding.createdAt };
      const findingNode: HiveNode = { id: `finding-detail-${finding.id}`, kind: "finding", label: finding.title, subtitle: finding.severity, status: finding.status, severity: finding.severity, metadata: { findingId: finding.id }, discoveredBy: finding.discoveredBy, createdAt: finding.createdAt };
      return { nodes: [asset, findingNode], edges: [{ id: `finding-detail-edge-${finding.id}`, source: asset.id, target: findingNode.id, relationship: "affected_by", metadata: { color: finding.severity === "critical" || finding.severity === "high" ? "danger" : "warning" } }] };
    }
    const included = new Set(targets.map((node) => node.id));
    let frontier = [...included];
    for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const edge of dashboard.graph.edges) if (frontier.includes(edge.target) && !included.has(edge.source)) { included.add(edge.source); next.push(edge.source); }
      frontier = next;
    }
    return { nodes: dashboard.graph.nodes.filter((node) => included.has(node.id)), edges: dashboard.graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)) };
  }, [dashboard, finding]);
  return <GraphCanvas nodes={nodes} edges={edges} mode="finding" compact ariaLabel={`Evidence chain for ${finding.title}`} onSelect={onSelect} />;
}
