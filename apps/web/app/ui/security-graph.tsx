"use client";

import {
  findingEvidencePath,
  projectSwarm,
  type AgentRun,
  type Dashboard,
  type Finding,
  type GraphEdge as HiveEdge,
  type GraphNode as HiveNode,
} from "@hiveswarm/contracts";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useNodesState,
} from "@xyflow/react";
import { Chip } from "@heroui/react/chip";
import { Kbd } from "@heroui/react/kbd";
import { Bot, Box, Braces, CircleAlert, Cloud, Folder, Globe2, Network, RotateCcw, Server, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
type StoredPositions = Record<string, { x: number; y: number }>;
type LegendItem = { label: string; color: "accent" | "danger" | "success" | "warning"; dotClass: string };

const layoutStoragePrefix = "hiveswarm.graph-layout.v1";

const graphLegends: Record<GraphMode, LegendItem[]> = {
  topology: [
    { label: "Asset", color: "accent", dotClass: "legend-dot--target" },
    { label: "Finding", color: "danger", dotClass: "legend-dot--finding" },
    { label: "Scope review", color: "warning", dotClass: "legend-dot--scope" },
  ],
  swarm: [
    { label: "Running", color: "success", dotClass: "legend-dot--active" },
    { label: "Waiting", color: "warning", dotClass: "legend-dot--scope" },
    { label: "Failed or finding", color: "danger", dotClass: "legend-dot--finding" },
  ],
  scope: [
    { label: "Allowed", color: "success", dotClass: "legend-dot--active" },
    { label: "Denied", color: "danger", dotClass: "legend-dot--finding" },
    { label: "Needs review", color: "warning", dotClass: "legend-dot--scope" },
  ],
  finding: [
    { label: "Evidence", color: "accent", dotClass: "legend-dot--target" },
    { label: "Finding", color: "danger", dotClass: "legend-dot--finding" },
  ],
};

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
  const rawColumns = nodes.map((node) => {
    const depth = Number(node.metadata.depth ?? 0);
    // Scope decisions and review candidates are siblings. Keeping them in one
    // rank prevents a root-to-review edge from crossing an intervening rule.
    return mode === "swarm" ? depth : mode === "scope" ? (node.kind === "engagement" ? 0 : 1) : topologyColumns[node.kind] ?? 1;
  });
  const findingRanks = mode === "finding" ? new Map([...new Set(rawColumns)].sort((a, b) => a - b).map((column, index) => [column, index])) : null;
  const columns = findingRanks ? rawColumns.map((column) => findingRanks.get(column) ?? 0) : rawColumns;
  const totals = new Map<number, number>();
  for (const column of columns) totals.set(column, (totals.get(column) ?? 0) + 1);
  const maxRows = Math.max(1, ...totals.values());
  const counts = new Map<number, number>();
  const gapX = mode === "scope" ? 330 : mode === "swarm" ? 292 : 284;
  const gapY = mode === "finding" ? 108 : 128;
  const width = mode === "scope" ? 224 : 196;

  return nodes.map((node, index) => {
    const column = columns[index] ?? 0;
    const row = counts.get(column) ?? 0;
    counts.set(column, row + 1);
    const columnRows = totals.get(column) ?? 1;
    const centeredOffset = ((maxRows - columnRows) * gapY) / 2;
    return {
      id: node.id,
      type: "hive",
      position: { x: column * gapX + 48, y: row * gapY + centeredOffset + 64 },
      data: node,
      style: { width },
    };
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
    pathOptions: { borderRadius: 18, offset: 30 },
    interactionWidth: 18,
    labelStyle: { fill: "var(--text-tertiary)", fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: "var(--surface-canvas)", fillOpacity: 0.92 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 4,
  }));
}

function readStoredPositions(storageKey: string): StoredPositions {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as StoredPositions;
    return Object.fromEntries(Object.entries(parsed).filter(([, position]) => Number.isFinite(position.x) && Number.isFinite(position.y)));
  } catch {
    return {};
  }
}

function writeStoredPositions(storageKey: string, nodes: HiveFlowNode[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(nodes.map((node) => [node.id, node.position]))));
  } catch {
    // A private browser session can reject local storage; dragging still works
    // for the current view without turning persistence into a blocked task.
  }
}

function clearStoredPositions(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Reset the in-memory layout even when storage is unavailable.
  }
}

function GraphLegend({ mode }: { mode: GraphMode }) {
  return (
    <div className="graph-legend" aria-label="Graph legend">
      {graphLegends[mode].map((item) => (
        <Chip key={item.label} className="graph-legend__chip" color={item.color} size="sm" variant="soft">
          <i className={`legend-dot ${item.dotClass}`} aria-hidden="true" />
          <Chip.Label>{item.label}</Chip.Label>
        </Chip>
      ))}
    </div>
  );
}

function GraphCanvas({ nodes, edges, mode, layoutId, ariaLabel, onSelect, selectedId = null, compact = false, fitRequestKey }: {
  nodes: HiveNode[];
  edges: HiveEdge[];
  mode: GraphMode;
  layoutId: string;
  ariaLabel: string;
  onSelect: (node: HiveNode | null) => void;
  selectedId?: string | null | undefined;
  compact?: boolean;
  fitRequestKey?: string | number | null | undefined;
}) {
  const automaticNodes = useMemo(() => positions(nodes, mode), [nodes, mode]);
  const graphEdges = useMemo(() => flowEdges(edges), [edges]);
  const [graphNodes, setGraphNodes, onNodesChange] = useNodesState<HiveFlowNode>(automaticNodes);
  const [activeId, setActiveId] = useState<string | null>(selectedId ?? null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const flow = useRef<ReactFlowInstance<HiveFlowNode, Edge> | null>(null);
  const graphNodesRef = useRef(graphNodes);
  const draggedNodeId = useRef<string | null>(null);
  const restoredStorageKey = useRef<string | null>(null);
  const storageKey = `${layoutStoragePrefix}:${layoutId}:${mode}`;

  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);

  const fitGraph = useCallback((duration = 0) => {
    const instance = flow.current;
    const element = canvas.current;
    if (!instance || !element) return;

    if (compact) {
      const { width: viewportWidth, height: viewportHeight } = element.getBoundingClientRect();
      const placedNodes = graphNodesRef.current;
      if (viewportWidth > 0 && viewportHeight > 0 && placedNodes.length) {
        const minX = Math.min(...placedNodes.map((node) => node.position.x));
        const minY = Math.min(...placedNodes.map((node) => node.position.y));
        const maxX = Math.max(...placedNodes.map((node) => node.position.x + (node.measured?.width ?? (typeof node.style?.width === "number" ? node.style.width : 196))));
        const maxY = Math.max(...placedNodes.map((node) => node.position.y + (node.measured?.height ?? 64)));
        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);
        const inset = 32;
        const zoom = Math.min(1.15, Math.max(0.28, Math.min((viewportWidth - inset * 2) / contentWidth, (viewportHeight - inset * 2) / contentHeight)));
        void instance.setViewport({
          x: viewportWidth / 2 - ((minX + maxX) / 2) * zoom,
          y: viewportHeight / 2 - ((minY + maxY) / 2) * zoom,
          zoom,
        }, { duration });
        return;
      }
    }

    void instance.fitView({ padding: compact ? 0.22 : 0.2, duration });
  }, [compact]);

  useEffect(() => setActiveId(selectedId ?? null), [selectedId]);
  useEffect(() => {
    // Compact evidence paths reopen centered on their current evidence. They
    // remain draggable for inspection, but intentionally do not restore an old
    // viewport-specific arrangement from a previous drawer session.
    const stored = compact ? {} : readStoredPositions(storageKey);
    const isNewLayout = restoredStorageKey.current !== storageKey;
    setGraphNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      return automaticNodes.map((node) => ({
        ...node,
        position: isNewLayout
          ? stored[node.id] ?? currentById.get(node.id)?.position ?? node.position
          : currentById.get(node.id)?.position ?? stored[node.id] ?? node.position,
        selected: node.id === activeId,
      }));
    });
    if (isNewLayout) {
      restoredStorageKey.current = storageKey;
      window.requestAnimationFrame(() => fitGraph(0));
    }
  }, [activeId, automaticNodes, fitGraph, setGraphNodes, storageKey]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    const refit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => fitGraph(0));
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    window.addEventListener("resize", refit);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [fitGraph]);
  useEffect(() => {
    if (fitRequestKey === undefined || fitRequestKey === null) return;
    const frame = window.requestAnimationFrame(() => fitGraph(0));
    // The second pass catches the final top-layer size after the drawer enters.
    const timer = window.setTimeout(() => fitGraph(0), 220);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [fitGraph, fitRequestKey]);
  const selectNode = useCallback((node: HiveFlowNode | null) => {
    setActiveId(node?.id ?? null);
    onSelect(node?.data ?? null);
  }, [onSelect]);

  const resetLayout = useCallback(() => {
    clearStoredPositions(storageKey);
    setGraphNodes(automaticNodes.map((node) => ({ ...node, selected: node.id === activeId })));
    window.requestAnimationFrame(() => fitGraph(180));
  }, [activeId, automaticNodes, fitGraph, setGraphNodes, storageKey]);

  return (
    <div ref={canvas} className={`graph graph--${mode}`} role="region" aria-label={ariaLabel}>
      <ReactFlow
        nodes={graphNodes}
        edges={graphEdges}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flow.current = instance;
          window.requestAnimationFrame(() => fitGraph(0));
        }}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => {
          if (draggedNodeId.current === node.id) return;
          selectNode(node);
        }}
        onNodeDragStart={(_, node) => { draggedNodeId.current = node.id; }}
        onNodeDragStop={(_, movedNode) => {
          if (!compact) writeStoredPositions(storageKey, graphNodes.map((node) => node.id === movedNode.id ? { ...node, position: movedNode.position } : node));
          window.setTimeout(() => { draggedNodeId.current = null; }, 0);
        }}
        onPaneClick={() => selectNode(null)}
        fitView
        fitViewOptions={{ padding: compact ? 0.22 : 0.2 }}
        minZoom={compact ? 0.28 : 0.35}
        maxZoom={1.8}
        nodesDraggable
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable={false}
        edgesReconnectable={false}
        elementsSelectable
        elevateNodesOnSelect
        snapToGrid
        snapGrid={[12, 12]}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--graph-dot)" />
        <Panel position="top-left"><GraphLegend mode={mode} /></Panel>
        {!compact ? <Panel position="top-right" className="graph-guide nodrag nopan">
          <span>Hold <Kbd className="graph-kbd" variant="light"><Kbd.Content>Space</Kbd.Content></Kbd> to pan</span>
          <button
            type="button"
            className="graph-layout-reset nodrag nopan"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => { event.stopPropagation(); resetLayout(); }}
            onClick={(event) => { if (event.detail === 0) resetLayout(); }}
          ><RotateCcw size={14} strokeWidth={1.7} aria-hidden="true" />Reset layout</button>
        </Panel> : null}
        <Controls showInteractive={false} position="bottom-left" aria-label="Graph zoom controls" />
        {!compact ? <MiniMap position="bottom-right" pannable zoomable nodeColor="var(--minimap-node)" maskColor="var(--minimap-mask)" style={{ background: "var(--surface-raised)" }} aria-label="Graph overview" /> : null}
      </ReactFlow>
    </div>
  );
}

export function SecurityGraph({ nodes, edges, layoutId, selectedId, onSelect }: { nodes: HiveNode[]; edges: HiveEdge[]; layoutId: string; selectedId?: string | null | undefined; onSelect: (node: HiveNode | null) => void }) {
  return <GraphCanvas nodes={nodes} edges={edges} mode="topology" layoutId={layoutId} selectedId={selectedId} ariaLabel="Infrastructure, application, and vulnerability topology" onSelect={onSelect} />;
}

export function SwarmGraph({ agents, findings, layoutId, selectedId, onSelectAgent, onSelectFinding }: {
  agents: AgentRun[];
  findings: Finding[];
  layoutId: string;
  selectedId?: string | null | undefined;
  onSelectAgent: (agentRunId: string) => void;
  onSelectFinding: (finding: Finding) => void;
}) {
  const { nodes, edges } = useMemo(() => projectSwarm(agents, findings), [agents, findings]);
  return <GraphCanvas nodes={nodes} edges={edges} mode="swarm" layoutId={layoutId} selectedId={selectedId} ariaLabel="Orchestrator, recursive subagents, statuses, and raised findings" onSelect={(node) => {
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

export function ScopeGraph({ dashboard, selectedId, onSelect }: { dashboard: Dashboard; selectedId?: string | null | undefined; onSelect: (node: HiveNode | null) => void }) {
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
  return <GraphCanvas nodes={nodes} edges={edges} mode="scope" layoutId={dashboard.engagement.id} selectedId={selectedId} ariaLabel="Allowed, denied, and proposed scope boundaries" onSelect={onSelect} />;
}

export function FindingPathGraph({ dashboard, finding, selectedId, fitRequestKey, onSelect }: { dashboard: Dashboard; finding: Finding; selectedId?: string | null | undefined; fitRequestKey?: string | number | null | undefined; onSelect: (node: HiveNode | null) => void }) {
  const { nodes, edges } = useMemo(() => findingEvidencePath(dashboard, finding), [dashboard, finding]);
  return <GraphCanvas nodes={nodes} edges={edges} mode="finding" layoutId={finding.id} selectedId={selectedId} compact fitRequestKey={fitRequestKey} ariaLabel={`Evidence chain for ${finding.title}`} onSelect={onSelect} />;
}
