import type { AgentRun, Dashboard, Finding, GraphEdge, GraphNode } from "./index.js";

export type EvidenceSubgraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export type EvidenceAttackPath = { labels: string[]; relationships: string[] };

function agentNode(agent: AgentRun): GraphNode {
  return {
    id: agent.id,
    kind: "agent",
    label: agent.agentName,
    subtitle: `${agent.lifecycle} · depth ${agent.depth}`,
    status: agent.status,
    metadata: { agentRunId: agent.id, depth: agent.depth, lifecycle: agent.lifecycle },
    discoveredBy: agent.parentAgentRunId ? "Parent agent" : "HiveSwarm",
    createdAt: agent.startedAt ?? agent.completedAt ?? "",
  };
}

export function projectSwarm(agents: AgentRun[], findings: Finding[]): EvidenceSubgraph {
  const nodes = agents.map(agentNode);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const edges: GraphEdge[] = agents.flatMap((agent) => agent.parentAgentRunId ? [{
    id: `agent-edge-${agent.id}`,
    source: agent.parentAgentRunId,
    target: agent.id,
    relationship: agent.depth === 1 ? "delegated" : "spawned",
    metadata: { animated: ["running", "starting"].includes(agent.status), color: agent.status === "failed" ? "danger" : agent.status === "waiting_approval" ? "warning" : "default" },
  }] : []);

  for (const finding of findings) {
    const owner = finding.agentRunId ? agentById.get(finding.agentRunId) : undefined;
    const findingNodeId = `swarm-${finding.id}`;
    nodes.push({
      id: findingNodeId,
      kind: "finding",
      label: finding.title,
      subtitle: `${finding.severity} · ${finding.assetLabel}`,
      severity: finding.severity,
      status: finding.status,
      metadata: { findingId: finding.id, ...(finding.agentRunId ? { agentRunId: finding.agentRunId } : {}), depth: Math.min(5, (owner?.depth ?? 0) + 1) },
      discoveredBy: finding.discoveredBy,
      createdAt: finding.createdAt,
    });
    if (owner) {
      edges.push({
        id: `finding-edge-${finding.id}`,
        source: owner.id,
        target: findingNodeId,
        relationship: "raised",
        metadata: { color: finding.severity === "critical" || finding.severity === "high" ? "danger" : finding.severity === "medium" ? "warning" : "default" },
      });
    }
  }
  return { nodes, edges };
}

export function findingEvidencePath(dashboard: Dashboard, finding: Finding): EvidenceSubgraph {
  const targets = dashboard.graph.nodes.filter((node) => node.metadata.findingId === finding.id);
  if (!targets.length) {
    const asset: GraphNode = { id: `finding-asset-${finding.id}`, kind: "endpoint", label: finding.assetLabel, subtitle: "Affected asset", status: "observed", metadata: {}, discoveredBy: finding.discoveredBy, createdAt: finding.createdAt };
    const findingNode: GraphNode = { id: `finding-detail-${finding.id}`, kind: "finding", label: finding.title, subtitle: finding.severity, status: finding.status, severity: finding.severity, metadata: { findingId: finding.id, ...(finding.agentRunId ? { agentRunId: finding.agentRunId } : {}) }, discoveredBy: finding.discoveredBy, createdAt: finding.createdAt };
    return { nodes: [asset, findingNode], edges: [{ id: `finding-detail-edge-${finding.id}`, source: asset.id, target: findingNode.id, relationship: "affected_by", metadata: { color: finding.severity === "critical" || finding.severity === "high" ? "danger" : "warning" } }] };
  }
  const included = new Set(targets.map((node) => node.id));
  let frontier = [...included];
  for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const edge of dashboard.graph.edges) {
      if (frontier.includes(edge.target) && !included.has(edge.source)) {
        included.add(edge.source);
        next.push(edge.source);
      }
    }
    frontier = next;
  }
  return {
    nodes: dashboard.graph.nodes.filter((node) => included.has(node.id)),
    edges: dashboard.graph.edges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
  };
}

export function evidenceAttackPaths(dashboard: Dashboard): EvidenceAttackPath[] {
  const byId = new Map(dashboard.graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of dashboard.graph.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const roots = dashboard.graph.nodes.filter((node) => ["engagement", "host", "website", "repository"].includes(node.kind));
  const paths: EvidenceAttackPath[] = [];
  const visit = (node: GraphNode, labels: string[], relationships: string[], seen: Set<string>) => {
    if (seen.has(node.id) || labels.length > 8 || paths.length >= 20) return;
    const nextSeen = new Set(seen).add(node.id);
    const nextLabels = [...labels, node.label];
    if (node.kind === "finding") {
      paths.push({ labels: nextLabels, relationships });
      return;
    }
    for (const edge of outgoing.get(node.id) ?? []) {
      const target = byId.get(edge.target);
      if (target) visit(target, nextLabels, [...relationships, edge.label ?? edge.relationship], nextSeen);
    }
  };
  for (const root of roots) visit(root, [], [], new Set());
  return paths;
}
