"use client";

import type { AgentManifest, Dashboard, GraphNode, SpawnAgentRequest } from "@hiveswarm/contracts";
import {
  Activity, Bot, Boxes, CircleDotDashed, Command, FileSearch, FileText,
  Hexagon, LayoutDashboard, Network, Play, Plus, Search, ShieldCheck, Target, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentRow } from "./agent-row";
import { ApprovalCard } from "./approval-card";
import { HiveMark } from "./brand";
import { SecurityGraph } from "./security-graph";
import { SeverityBadge, Status } from "./status";
import { SpawnDialog } from "./spawn-dialog";
import { EngagementDialog } from "./engagement-dialog";
import { RegistryView } from "./registry-view";
import { ReportView, type ReportData } from "./report-view";
import { ScopeView } from "./scope-view";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
type EvidenceView = "graph" | "findings" | "activity";
type PageView = "evaluation" | "registry" | "findings" | "scope" | "report";

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

export function HiveConsole() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<AgentManifest[]>([]);
  const [activeView, setActiveView] = useState<EvidenceView>("graph");
  const [pageView, setPageView] = useState<PageView>("evaluation");
  const [selectedAgentId, setSelectedAgentId] = useState("ar_explorer");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
    const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
    const source = new EventSource(`${apiUrl}/api/runs/${runId}/events`);
    source.onmessage = () => void refresh();
    ["agent.started", "agent.queued", "agent.completed", "agent.failed", "agent.terminated", "approval.requested", "approval.approved", "approval.denied", "agent.log", "agent.node", "agent.edge", "agent.finding", "agent.artifact", "agent.scope_proposal", "run.paused", "run.running"]
      .forEach((eventName) => source.addEventListener(eventName, () => void refresh()));
    return () => source.close();
  }, [dashboard?.engagement.id, refresh]);
  useEffect(() => {
    if (pageView !== "report") return;
    setReportLoading(true);
    fetch(`${apiUrl}/api/reports/current`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Unable to generate the report."); setReport(await response.json() as ReportData); })
      .catch((cause) => setStatusMessage(cause instanceof Error ? cause.message : "Unable to generate the report."))
      .finally(() => setReportLoading(false));
  }, [pageView, dashboard?.findings, dashboard?.artifacts]);

  const selectedAgent = dashboard?.agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const pendingApproval = dashboard?.approvals.find((approval) => approval.status === "pending") ?? null;
  const criticalCount = dashboard?.findings.filter((finding) => finding.severity === "critical" || finding.severity === "high").length ?? 0;
  const sortedFindings = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return [...(dashboard?.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [dashboard?.findings]);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleFindings = sortedFindings.filter((finding) => !normalizedQuery || `${finding.title} ${finding.assetLabel} ${finding.summary} ${finding.severity}`.toLowerCase().includes(normalizedQuery));
  const visibleLogs = (dashboard?.logs ?? []).filter((log) => !normalizedQuery || log.message.toLowerCase().includes(normalizedQuery) || dashboard?.agents.find((agent) => agent.id === log.agentRunId)?.agentName.toLowerCase().includes(normalizedQuery));
  const visibleNodes = (dashboard?.graph.nodes ?? []).filter((node) => !normalizedQuery || `${node.label} ${node.subtitle ?? ""} ${node.kind}`.toLowerCase().includes(normalizedQuery));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = (dashboard?.graph.edges ?? []).filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

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
    const runId = dashboard?.agents[0]?.runId ?? dashboard?.engagement.id ?? "current";
    const response = await fetch(`${apiUrl}/api/runs/${runId}/agents`, {
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
    const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
    const response = await fetch(`${apiUrl}/api/runs/${runId}/state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (!response.ok) { setStatusMessage("Unable to change the run state."); return; }
    setStatusMessage(status === "paused" ? "The evaluation is paused." : "The evaluation is running.");
    await refresh();
  }

  async function runOrchestrator() {
    if (!dashboard) return;
    setOrchestrating(true); setStatusMessage("");
    try {
      const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
      const response = await fetch(`${apiUrl}/api/runs/${runId}/orchestrate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const payload = await response.json() as { error?: string; spawned?: unknown[] };
      if (!response.ok) throw new Error(payload.error ?? "Unable to run the orchestrator.");
      setStatusMessage(`The orchestrator started ${payload.spawned?.length ?? 0} specialists.`);
      await refresh();
    } catch (cause) { setStatusMessage(cause instanceof Error ? cause.message : "Unable to run the orchestrator."); }
    finally { setOrchestrating(false); }
  }

  async function terminateAgent(agentRunId: string) {
    const response = await fetch(`${apiUrl}/api/agent-runs/${agentRunId}/terminate`, { method: "POST" });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to terminate the agent.");
    setStatusMessage("The agent was terminated.");
    await refresh();
  }

  async function installManifest(manifest: unknown) {
    const response = await fetch(`${apiUrl}/api/agents/install`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest) });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to install the manifest.");
    setStatusMessage("The agent manifest was installed.");
    await refresh();
  }

  async function addScopeRule(rule: { kind: "host" | "domain" | "cidr" | "url-prefix" | "repository"; value: string; action: "allow" | "deny" }) {
    const response = await fetch(`${apiUrl}/api/scope/rules`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule) });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to add the scope rule.");
    setStatusMessage("The scope rule was added.");
    await refresh();
  }

  async function removeScopeRule(ruleId: string) {
    const response = await fetch(`${apiUrl}/api/scope/rules/${ruleId}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to remove the scope rule.");
    setStatusMessage("The scope rule was removed.");
    await refresh();
  }

  async function createEngagement(input: { name: string; target: string }) {
    const normalized = input.target.includes("://") ? new URL(input.target).hostname : input.target;
    const kind = input.target.startsWith("repository:") ? "repository" : "host";
    const response = await fetch(`${apiUrl}/api/engagements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, scopeRules: [{ id: "scope_primary", kind, value: kind === "repository" ? input.target : normalized, action: "allow" }] }) });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Unable to create the engagement.");
    setPageView("evaluation"); setActiveView("graph"); setSelectedAgentId(""); setSelectedNode(null);
    setStatusMessage("The engagement was created. Run the orchestrator when you are ready.");
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
      {statusMessage ? <div className="status-toast"><span>{statusMessage}</span><button aria-label="Dismiss message" onClick={() => setStatusMessage("")}><X size={16} aria-hidden="true" /></button></div> : null}
      <header className="topbar">
        <a className="brand" href="/" aria-label="HiveSwarm home"><HiveMark small /><span>HiveSwarm</span><small>alpha</small></a>
        <div className="breadcrumbs" aria-label="Current engagement"><span>Engagements</span><span aria-hidden="true">/</span><strong>{dashboard.engagement.name}</strong></div>
        <div className="topbar__actions">
          <span className="environment-switch"><span className="status__dot" aria-hidden="true" />Local workspace</span>
          <span className="avatar" aria-label="Signed in as Sma Das">SD</span>
        </div>
      </header>

      <aside className="sidebar" aria-label="Workspace navigation">
        <nav className="primary-nav" aria-label="Primary">
          <button className={`nav-item ${pageView === "evaluation" ? "is-active" : ""}`} aria-current={pageView === "evaluation" ? "page" : undefined} onClick={() => { setPageView("evaluation"); setActiveView("graph"); }}><LayoutDashboard size={17} strokeWidth={1.5} aria-hidden="true" />Evaluation</button>
          <button className={`nav-item ${pageView === "registry" ? "is-active" : ""}`} aria-current={pageView === "registry" ? "page" : undefined} onClick={() => setPageView("registry")}><Bot size={17} strokeWidth={1.5} aria-hidden="true" />Agent registry<span className="nav-count">{agents.length}</span></button>
          <button className={`nav-item ${pageView === "findings" ? "is-active" : ""}`} aria-current={pageView === "findings" ? "page" : undefined} onClick={() => { setPageView("findings"); setActiveView("findings"); }}><ShieldCheck size={17} strokeWidth={1.5} aria-hidden="true" />Findings<span className="nav-count nav-count--risk">{criticalCount}</span></button>
          <button className={`nav-item ${pageView === "scope" ? "is-active" : ""}`} aria-current={pageView === "scope" ? "page" : undefined} onClick={() => setPageView("scope")}><Target size={17} strokeWidth={1.5} aria-hidden="true" />Scope</button>
          <button className={`nav-item ${pageView === "report" ? "is-active" : ""}`} aria-current={pageView === "report" ? "page" : undefined} onClick={() => setPageView("report")}><FileText size={17} strokeWidth={1.5} aria-hidden="true" />Report</button>
        </nav>

        <section className="swarm-section" id="agent-swarm" aria-labelledby="swarm-title">
          <div className="section-label"><h2 id="swarm-title">Live swarm</h2><span>{dashboard.metrics.activeAgents} active</span></div>
          <div className="agent-tree">
            {dashboard.agents.map((agent) => <AgentRow key={agent.id} agent={agent} selected={agent.id === selectedAgentId} onSelect={() => setSelectedAgentId(agent.id)} />)}
          </div>
          <button className="add-agent" onClick={() => setSpawnOpen(true)}><Plus size={16} strokeWidth={2} aria-hidden="true" />Start specialist</button>
        </section>

        <div className="utility-nav"><button className="nav-item" onClick={() => setEngagementOpen(true)}><Plus size={17} strokeWidth={1.5} aria-hidden="true" />New engagement</button></div>
      </aside>

      <main className="workspace" id="main">
        {pageView === "evaluation" || pageView === "findings" ? <>
        <section className="workspace-header" aria-labelledby="page-title">
          <div className="workspace-heading">
            <div className="target-mark"><Hexagon size={21} strokeWidth={1.5} aria-hidden="true" /></div>
            <div><div className="title-line"><h1 id="page-title">{dashboard.engagement.name}</h1><Status value={dashboard.engagement.status === "waiting_approval" || dashboard.engagement.status === "paused" ? "paused" : "active"} /></div><p><bdi>{dashboard.engagement.target}</bdi><span aria-hidden="true">·</span>Started {relativeTime(dashboard.engagement.startedAt)}</p></div>
          </div>
          <div className="workspace-actions">
            <button className="button button--quiet" onClick={() => void toggleRun()}><CircleDotDashed size={16} strokeWidth={1.5} aria-hidden="true" />{dashboard.engagement.status === "paused" ? "Resume run" : "Pause run"}</button>
            <button className="button button--primary" disabled={orchestrating || dashboard.engagement.status === "paused"} onClick={() => void runOrchestrator()}><Play size={16} strokeWidth={2} aria-hidden="true" />{orchestrating ? "Orchestrating" : "Run orchestrator"}</button>
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
              <button aria-pressed={pageView === "evaluation" && activeView === "graph"} onClick={() => { setPageView("evaluation"); setActiveView("graph"); }}><Network size={15} strokeWidth={1.5} aria-hidden="true" />Graph</button>
              <button aria-pressed={pageView === "findings" || activeView === "findings"} onClick={() => { setPageView("findings"); setActiveView("findings"); }}><FileSearch size={15} strokeWidth={1.5} aria-hidden="true" />Findings <span>{dashboard.findings.length}</span></button>
              <button aria-pressed={pageView === "evaluation" && activeView === "activity"} onClick={() => { setPageView("evaluation"); setActiveView("activity"); }}><Activity size={15} strokeWidth={1.5} aria-hidden="true" />Activity</button>
            </div>
            <div className="toolbar-actions">
              <label className="search-control"><span className="sr-only">Search evidence</span><Search size={15} strokeWidth={1.5} aria-hidden="true" /><input type="search" aria-label="Search evidence" placeholder="Search evidence" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
            </div>
          </div>

          {pageView !== "findings" && activeView === "graph" ? (
            <div className="graph-wrap">
              <SecurityGraph nodes={visibleNodes} edges={visibleEdges} onSelect={setSelectedNode} />
              <div className="graph-legend" aria-label="Graph legend"><span><i className="legend-dot legend-dot--target" />Asset</span><span><i className="legend-dot legend-dot--finding" />Finding</span><span><i className="legend-dot legend-dot--scope" />Scope review</span></div>
            </div>
          ) : pageView === "findings" || activeView === "findings" ? (
            <div className="finding-table" id="findings">
              <div className="finding-table__head"><span>Finding</span><span>Asset</span><span>Confidence</span><span>Status</span></div>
              {visibleFindings.map((finding) => (
                <article className="finding-row" key={finding.id}>
                  <div><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p>{finding.summary}</p></div>
                  <bdi>{finding.assetLabel}</bdi><span className="numeric">{Math.round(finding.confidence * 100)}%</span><span>{finding.status}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="activity-feed">
              {visibleLogs.map((log) => {
                const owner = dashboard.agents.find((agent) => agent.id === log.agentRunId)?.agentName ?? "Agent";
                return <article className={`log-row log-row--${log.level}`} key={log.id}><span className="log-row__time">{relativeTime(log.timestamp)}</span><span className="log-row__agent">{owner}</span><p>{log.message}</p></article>;
              })}
            </div>
          )}
        </section>
        </> : pageView === "registry" ? (
          <RegistryView agents={agents} onInstall={installManifest} />
        ) : pageView === "scope" ? (
          <ScopeView rules={dashboard.engagement.scopeRules} onAdd={addScopeRule} onRemove={removeScopeRule} />
        ) : (
          <ReportView report={report} loading={reportLoading} apiUrl={apiUrl} />
        )}
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
              {selectedAgent.depth > 0 && !["completed", "failed", "terminated"].includes(selectedAgent.status) ? <button className="button button--danger button--full" onClick={() => {
                if (window.confirm(`Terminate ${selectedAgent.agentName}? Its current task will stop and cannot be resumed.`)) void terminateAgent(selectedAgent.id).catch((cause) => setStatusMessage(cause instanceof Error ? cause.message : "Unable to terminate the agent."));
              }}>Terminate agent</button> : null}
            </div>
          ) : <p className="empty-copy">Select an agent or graph node to inspect its evidence and state.</p>}
        </section>

        <section className="inspector-section" aria-labelledby="recent-title">
          <div className="section-label"><h2 id="recent-title">Priority findings</h2><button onClick={() => { setPageView("findings"); setActiveView("findings"); }}>View all findings</button></div>
          <div className="priority-list">
            {sortedFindings.slice(0, 3).map((finding) => <article key={finding.id}><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p><bdi>{finding.assetLabel}</bdi> · {relativeTime(finding.createdAt)}</p></article>)}
          </div>
        </section>

        {pendingApproval ? <section className="inspector-section" id="approval-detail" aria-labelledby="approval-detail-title"><div className="section-label"><h2 id="approval-detail-title">Requested action</h2></div><p className="detail-copy">{pendingApproval.requestedAction}</p><p className="detail-meta">Requested by {pendingApproval.requestedBy} · {relativeTime(pendingApproval.createdAt)}</p></section> : null}
      </aside>

      <SpawnDialog open={spawnOpen} agents={agents} parentAgents={dashboard.agents} target={dashboard.engagement.target} onClose={() => setSpawnOpen(false)} onSpawn={spawn} />
      <EngagementDialog open={engagementOpen} onClose={() => setEngagementOpen(false)} onCreate={createEngagement} />
    </div>
  );
}
