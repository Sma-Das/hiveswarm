"use client";

import type { AgentManifest, Dashboard, GraphNode, SpawnAgentRequest } from "@hiveswarm/contracts";
import {
  Activity, Bell, Bot, Boxes, ChevronDown, CircleDotDashed, Command, FileSearch, GitFork,
  Hexagon, LayoutDashboard, ListFilter, Network, Plus, Search, Settings, ShieldCheck, Target, UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentRow } from "./agent-row";
import { ApprovalCard } from "./approval-card";
import { HiveMark } from "./brand";
import { SecurityGraph } from "./security-graph";
import { SeverityBadge, Status } from "./status";
import { SpawnDialog } from "./spawn-dialog";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
type View = "graph" | "findings" | "activity";

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

export function HiveConsole() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<AgentManifest[]>([]);
  const [activeView, setActiveView] = useState<View>("graph");
  const [selectedAgentId, setSelectedAgentId] = useState("ar_explorer");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [dashboardResponse, agentsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/dashboard`, { cache: "no-store" }),
        fetch(`${apiUrl}/api/agents`, { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !agentsResponse.ok) throw new Error("The orchestration API is unavailable.");
      setDashboard(await dashboardResponse.json() as Dashboard);
      setAgents((await agentsResponse.json() as { agents: AgentManifest[] }).agents);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the evaluation.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!dashboard) return;
    const source = new EventSource(`${apiUrl}/api/runs/run_demo/events`);
    source.onmessage = () => void refresh();
    ["agent.started", "agent.queued", "approval.requested", "approval.approved", "approval.denied", "agent.log", "agent.node", "agent.edge", "agent.finding", "agent.scope_proposal", "run.paused", "run.running"]
      .forEach((eventName) => source.addEventListener(eventName, () => void refresh()));
    return () => source.close();
  }, [dashboard?.engagement.id, refresh]);

  const selectedAgent = dashboard?.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const pendingApproval = dashboard?.approvals.find((approval) => approval.status === "pending") ?? null;
  const criticalCount = dashboard?.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length ?? 0;
  const sortedFindings = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...(dashboard?.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [dashboard?.findings]);

  async function decide(decision: "approved" | "denied") {
    if (!pendingApproval) return;
    setDecisionBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/approvals/${pendingApproval.id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to save the decision.");
      setStatusMessage(decision === "approved" ? "The request was approved once." : "The request was denied.");
      await refresh();
    } catch (cause) { setStatusMessage(cause instanceof Error ? cause.message : "Unable to save the decision."); }
    finally { setDecisionBusy(false); }
  }

  async function spawn(request: SpawnAgentRequest) {
    const response = await fetch(`${apiUrl}/api/runs/run_demo/agents`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    const payload = await response.json() as { error?: string; approvalRequired?: boolean };
    if (!response.ok) throw new Error(payload.error ?? "Unable to start the specialist.");
    setStatusMessage(payload.approvalRequired ? "The specialist is waiting for approval." : "The specialist is starting.");
    await refresh();
  }

  async function toggleRun() {
    if (!dashboard) return;
    const status = dashboard.engagement.status === "paused" ? "running" : "paused";
    const response = await fetch(`${apiUrl}/api/runs/run_demo/state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!response.ok) { setStatusMessage("Unable to change the run state."); return; }
    setStatusMessage(status === "paused" ? "The evaluation is paused." : "The evaluation is running.");
    await refresh();
  }

  if (!dashboard) {
    return (
      <main id="main" className="loading-state" aria-busy={!error}>
        <HiveMark />
        <h1>{error ? "Unable to open HiveSwarm" : "Opening the evaluation"}</h1>
        <p>{error || "Connecting to the orchestrator and loading evidence…"}</p>
        {error ? <button className="button button--primary" onClick={() => void refresh()}>Try again</button> : <span className="loading-bar" aria-hidden="true" />}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="sr-only" role="status">{statusMessage}</div>
      <header className="topbar">
        <a className="brand" href="/" aria-label="HiveSwarm home"><HiveMark small /><span>HiveSwarm</span><small>alpha</small></a>
        <div className="breadcrumbs" aria-label="Current engagement"><span>Engagements</span><span aria-hidden="true">/</span><strong>{dashboard.engagement.name}</strong></div>
        <div className="topbar__actions">
          <button className="environment-switch"><span className="status__dot" aria-hidden="true" />Local workspace<ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" /></button>
          <button className="icon-button" aria-label="Notifications"><Bell size={18} strokeWidth={1.5} aria-hidden="true" /><span className="notification-dot" aria-hidden="true" /></button>
          <button className="avatar" aria-label="Open account menu">SD</button>
        </div>
      </header>

      <aside className="sidebar" aria-label="Workspace navigation">
        <nav className="primary-nav" aria-label="Primary">
          <a className="nav-item is-active" href="#main" aria-current="page"><LayoutDashboard size={17} strokeWidth={1.5} aria-hidden="true" />Evaluation</a>
          <a className="nav-item" href="#agent-swarm"><Bot size={17} strokeWidth={1.5} aria-hidden="true" />Agent registry<span className="nav-count">{agents.length}</span></a>
          <a className="nav-item" href="#findings"><ShieldCheck size={17} strokeWidth={1.5} aria-hidden="true" />Findings<span className="nav-count nav-count--risk">{criticalCount}</span></a>
          <a className="nav-item" href="#scope"><Target size={17} strokeWidth={1.5} aria-hidden="true" />Scope</a>
        </nav>

        <section className="swarm-section" id="agent-swarm" aria-labelledby="swarm-title">
          <div className="section-label"><h2 id="swarm-title">Live swarm</h2><span>{dashboard.metrics.activeAgents} active</span></div>
          <div className="agent-tree">
            {dashboard.agents.map((agent) => <AgentRow key={agent.id} agent={agent} selected={agent.id === selectedAgentId} onSelect={() => setSelectedAgentId(agent.id)} />)}
          </div>
          <button className="add-agent" onClick={() => setSpawnOpen(true)}><Plus size={16} strokeWidth={2} aria-hidden="true" />Start specialist</button>
        </section>

        <nav className="utility-nav" aria-label="Workspace utilities">
          <a className="nav-item" href="#team"><UsersRound size={17} strokeWidth={1.5} aria-hidden="true" />Team</a>
          <a className="nav-item" href="#settings"><Settings size={17} strokeWidth={1.5} aria-hidden="true" />Settings</a>
        </nav>
      </aside>

      <main className="workspace" id="main">
        <section className="workspace-header" aria-labelledby="page-title">
          <div className="workspace-heading">
            <div className="target-mark"><Hexagon size={21} strokeWidth={1.5} aria-hidden="true" /></div>
            <div><div className="title-line"><h1 id="page-title">{dashboard.engagement.name}</h1><Status value={dashboard.engagement.status === "waiting_approval" || dashboard.engagement.status === "paused" ? "paused" : "active"} /></div><p><bdi>{dashboard.engagement.target}</bdi><span aria-hidden="true">·</span>Started {relativeTime(dashboard.engagement.startedAt)}</p></div>
          </div>
          <div className="workspace-actions">
            <button className="button button--quiet" onClick={() => void toggleRun()}><CircleDotDashed size={16} strokeWidth={1.5} aria-hidden="true" />{dashboard.engagement.status === "paused" ? "Resume run" : "Pause run"}</button>
            <button className="button button--primary" onClick={() => setSpawnOpen(true)}><Plus size={16} strokeWidth={2} aria-hidden="true" />Start specialist</button>
          </div>
        </section>

        <section className="metric-strip" aria-label="Evaluation summary">
          <div><span>Active agents</span><strong>{dashboard.metrics.activeAgents}</strong><small>{dashboard.agents.length} total executions</small></div>
          <div><span>Mapped assets</span><strong>{dashboard.metrics.assets}</strong><small>{dashboard.graph.edges.length} relationships</small></div>
          <div><span>Findings</span><strong>{dashboard.metrics.findings}</strong><small className="risk-copy">{criticalCount} high priority</small></div>
          <div><span>Scope decisions</span><strong>{dashboard.metrics.pendingApprovals}</strong><small>{dashboard.engagement.scopeRules.length} active rules</small></div>
        </section>

        <section className="evidence-panel" aria-label="Evaluation evidence">
          <div className="evidence-toolbar">
            <div className="view-switch" aria-label="Evidence view">
              <button aria-pressed={activeView === "graph"} onClick={() => setActiveView("graph")}><Network size={15} strokeWidth={1.5} aria-hidden="true" />Graph</button>
              <button aria-pressed={activeView === "findings"} onClick={() => setActiveView("findings")}><FileSearch size={15} strokeWidth={1.5} aria-hidden="true" />Findings <span>{dashboard.findings.length}</span></button>
              <button aria-pressed={activeView === "activity"} onClick={() => setActiveView("activity")}><Activity size={15} strokeWidth={1.5} aria-hidden="true" />Activity</button>
            </div>
            <div className="toolbar-actions">
              <label className="search-control"><span className="sr-only">Search evidence</span><Search size={15} strokeWidth={1.5} aria-hidden="true" /><input type="search" aria-label="Search evidence" placeholder="Search evidence" /></label>
              <button className="icon-button icon-button--toolbar" aria-label="Filter evidence"><ListFilter size={17} strokeWidth={1.5} aria-hidden="true" /></button>
            </div>
          </div>

          {activeView === "graph" ? (
            <div className="graph-wrap">
              <SecurityGraph nodes={dashboard.graph.nodes} edges={dashboard.graph.edges} onSelect={setSelectedNode} />
              <div className="graph-legend" aria-label="Graph legend"><span><i className="legend-dot legend-dot--target" />Asset</span><span><i className="legend-dot legend-dot--finding" />Finding</span><span><i className="legend-dot legend-dot--scope" />Scope review</span></div>
            </div>
          ) : activeView === "findings" ? (
            <div className="finding-table" id="findings">
              <div className="finding-table__head"><span>Finding</span><span>Asset</span><span>Confidence</span><span>Status</span></div>
              {sortedFindings.map((finding) => (
                <article className="finding-row" key={finding.id}>
                  <div><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p>{finding.summary}</p></div>
                  <bdi>{finding.assetLabel}</bdi><span className="numeric">{Math.round(finding.confidence * 100)}%</span><span>{finding.status}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="activity-feed">
              {dashboard.logs.map((log) => {
                const owner = dashboard.agents.find((agent) => agent.id === log.agentRunId)?.agentName ?? "Agent";
                return <article className={`log-row log-row--${log.level}`} key={log.id}><span className="log-row__time">{relativeTime(log.timestamp)}</span><span className="log-row__agent">{owner}</span><p>{log.message}</p></article>;
              })}
            </div>
          )}
        </section>
      </main>

      <aside className="inspector" aria-label="Evaluation details">
        {pendingApproval ? <ApprovalCard approval={pendingApproval} busy={decisionBusy} onDecision={(decision) => void decide(decision)} /> : null}

        <section className="inspector-section" aria-labelledby="selection-title">
          <div className="section-label"><h2 id="selection-title">{selectedNode ? "Selected asset" : "Selected agent"}</h2><Command size={15} strokeWidth={1.5} aria-hidden="true" /></div>
          {selectedNode ? (
            <div className="selection-card">
              <span className="selection-card__icon"><Boxes size={19} strokeWidth={1.5} aria-hidden="true" /></span>
              <div><strong>{selectedNode.label}</strong><p>{selectedNode.subtitle ?? selectedNode.kind}</p></div>
              <dl><div><dt>Type</dt><dd>{selectedNode.kind}</dd></div><div><dt>Status</dt><dd>{selectedNode.status ?? "observed"}</dd></div><div><dt>Discovered by</dt><dd>{selectedNode.discoveredBy ?? "Unknown"}</dd></div></dl>
              <button className="button button--quiet button--full" onClick={() => setSelectedNode(null)}>Return to agent</button>
            </div>
          ) : selectedAgent ? (
            <div className="selection-card">
              <span className="selection-card__icon"><Bot size={19} strokeWidth={1.5} aria-hidden="true" /></span>
              <div><strong>{selectedAgent.agentName}</strong><p>{selectedAgent.task}</p></div>
              <dl><div><dt>Lifecycle</dt><dd>{selectedAgent.lifecycle}</dd></div><div><dt>Depth</dt><dd className="numeric">{selectedAgent.depth} / 5</dd></div><div><dt>Events</dt><dd className="numeric">{selectedAgent.logCount}</dd></div></dl>
              <Status value={selectedAgent.status} />
            </div>
          ) : <p className="empty-copy">Select an agent or graph node to inspect its evidence and state.</p>}
        </section>

        <section className="inspector-section" aria-labelledby="recent-title">
          <div className="section-label"><h2 id="recent-title">Priority findings</h2><button onClick={() => setActiveView("findings")}>View all</button></div>
          <div className="priority-list">
            {sortedFindings.slice(0, 3).map((finding) => <article key={finding.id}><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p><bdi>{finding.assetLabel}</bdi> · {relativeTime(finding.createdAt)}</p></article>)}
          </div>
        </section>

        {pendingApproval ? <section className="inspector-section" id="approval-detail" aria-labelledby="approval-detail-title"><div className="section-label"><h2 id="approval-detail-title">Requested action</h2></div><p className="detail-copy">{pendingApproval.requestedAction}</p><p className="detail-meta">Requested by {pendingApproval.requestedBy} · {relativeTime(pendingApproval.createdAt)}</p></section> : null}
      </aside>

      <SpawnDialog open={spawnOpen} agents={agents} parentAgents={dashboard.agents} target={dashboard.engagement.target} onClose={() => setSpawnOpen(false)} onSpawn={spawn} />
    </div>
  );
}
