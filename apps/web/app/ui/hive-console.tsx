"use client";

import type { AgentRun, Finding, GraphNode, SpawnAgentRequest } from "@hiveswarm/contracts";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Activity, Bot, Boxes, ChevronDown, CircleDotDashed, Command, FileSearch, FileText,
  GitFork, Hexagon, LayoutDashboard, Network, Play, Plus, Search, SearchX, ShieldCheck, Target, Waypoints, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AgentRow } from "./agent-row";
import { ApprovalCard } from "./approval-card";
import { HiveMark } from "./brand";
import { ScopeGraph, SecurityGraph, SwarmGraph } from "./security-graph";
import { SeverityBadge, Status } from "./status";
import { SpawnDialog } from "./spawn-dialog";
import { EngagementDialog } from "./engagement-dialog";
import { RegistryView } from "./registry-view";
import { ReportView, type ReportData } from "./report-view";
import { ScopeView } from "./scope-view";
import { ProjectSwitcher } from "./project-switcher";
import { FindingDrawer } from "./finding-drawer";
import { useProjectWorkspace } from "./use-project-workspace";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
type EvidenceView = "topology" | "swarm" | "scope" | "findings" | "activity";
type PageView = "evaluation" | "registry" | "findings" | "scope" | "report";

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

function FilteredEmpty({ query, noun, onClear }: { query: string; noun: string; onClear: () => void }) {
  return (
    <div className="filtered-empty">
      <SearchX size={24} strokeWidth={1.5} aria-hidden="true" />
      <h2>No {noun} match “{query}”</h2>
      <p>Try another search or clear the current filter.</p>
      <button className="button button--quiet" onClick={onClear}>Clear search</button>
    </div>
  );
}

function AgentSelectionCard({ agent, onTerminate }: { agent: AgentRun; onTerminate: () => void }) {
  const canTerminate = agent.depth > 0 && !["completed", "failed", "terminated"].includes(agent.status);
  return (
    <div className="selection-card">
      <span className="selection-card__icon"><Bot size={19} strokeWidth={1.5} aria-hidden="true" /></span>
      <div><strong>{agent.agentName}</strong><p>{agent.task}</p></div>
      <dl><div><dt>Lifecycle</dt><dd>{agent.lifecycle}</dd></div><div><dt>Depth</dt><dd className="numeric">{agent.depth} / 5</dd></div><div><dt>Events</dt><dd className="numeric">{agent.logCount}</dd></div></dl>
      <Status value={agent.status} />
      {canTerminate ? <button className="button button--danger button--full" onClick={onTerminate}>Terminate agent</button> : null}
    </div>
  );
}

export function HiveConsole() {
  const { dashboard, agents, projects, activeProjectId, error, refresh, execute, loadReport } = useProjectWorkspace();
  const [activeView, setActiveView] = useState<EvidenceView>("topology");
  const [pageView, setPageView] = useState<PageView>("evaluation");
  const [selectedAgentId, setSelectedAgentId] = useState("ar_explorer");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [orchestrating, setOrchestrating] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  useEffect(() => {
    if (!dashboard) return;
    setSelectedAgentId((current) => dashboard.agents.some((agent) => agent.id === current) ? current : dashboard.agents[0]?.id ?? "");
  }, [dashboard]);
  useEffect(() => {
    if (pageView !== "report") return;
    setReportLoading(true);
    loadReport(dashboard?.engagement.id ?? "")
      .then((nextReport) => setReport(nextReport as ReportData))
      .catch((cause) => setStatusMessage(cause instanceof Error ? cause.message : "Unable to generate the report."))
      .finally(() => setReportLoading(false));
  }, [pageView, dashboard?.findings, dashboard?.artifacts, dashboard?.engagement.id, loadReport]);

  function selectGraphNode(node: GraphNode | null) {
    if (!node) { setSelectedNode(null); return; }
    const findingId = node.metadata.findingId;
    if (typeof findingId === "string") {
      const finding = dashboard?.findings.find((item) => item.id === findingId);
      if (finding) { setSelectedFinding(finding); return; }
    }
    setSelectedNode(node);
  }

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
  const visibleAgents = (dashboard?.agents ?? []).filter((agent) => !normalizedQuery || `${agent.agentName} ${agent.task} ${agent.status}`.toLowerCase().includes(normalizedQuery));
  const visibleNodes = (dashboard?.graph.nodes ?? []).filter((node) => !normalizedQuery || `${node.label} ${node.subtitle ?? ""} ${node.kind}`.toLowerCase().includes(normalizedQuery));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = (dashboard?.graph.edges ?? []).filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const searchResultMessage = normalizedQuery && (pageView === "evaluation" || pageView === "findings")
    ? pageView === "findings" || activeView === "findings"
      ? `${visibleFindings.length} ${visibleFindings.length === 1 ? "finding" : "findings"} match ${searchQuery.trim()}.`
      : activeView === "activity"
        ? `${visibleLogs.length} ${visibleLogs.length === 1 ? "event" : "events"} match ${searchQuery.trim()}.`
        : activeView === "swarm"
          ? `${visibleAgents.length + visibleFindings.length} swarm items match ${searchQuery.trim()}.`
          : activeView === "topology"
            ? `${visibleNodes.length} ${visibleNodes.length === 1 ? "asset" : "assets"} match ${searchQuery.trim()}.`
            : ""
    : "";

  async function decide(decision: "approved" | "denied") {
    if (!pendingApproval) return;
    setDecisionBusy(true);
    try {
      const result = await execute({ type: "decide", approvalId: pendingApproval.id, decision });
      setStatusMessage(result.message);
    } catch (cause) { setStatusMessage(cause instanceof Error ? cause.message : "Unable to save the decision."); }
    finally { setDecisionBusy(false); }
  }

  async function spawn(request: SpawnAgentRequest) {
    const runId = dashboard?.agents[0]?.runId ?? dashboard?.engagement.id ?? "current";
    const result = await execute({ type: "spawn", runId, request });
    setStatusMessage(result.message);
  }

  async function toggleRun() {
    if (!dashboard) return;
    const status = dashboard.engagement.status === "paused" ? "running" : "paused";
    const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
    try {
      const result = await execute({ type: "set-run-state", runId, status });
      setStatusMessage(result.message);
    } catch (cause) {
      setStatusMessage(cause instanceof Error ? cause.message : "Unable to change the run state.");
    }
  }

  async function runOrchestrator() {
    if (!dashboard) return;
    setOrchestrating(true); setStatusMessage("");
    try {
      const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
      const result = await execute({ type: "orchestrate", runId });
      setStatusMessage(result.message);
    } catch (cause) { setStatusMessage(cause instanceof Error ? cause.message : "Unable to run the orchestrator."); }
    finally { setOrchestrating(false); }
  }

  async function terminateAgent(agentRunId: string) {
    const result = await execute({ type: "terminate-agent", agentRunId });
    setStatusMessage(result.message);
  }

  function requestAgentTermination(agent: AgentRun) {
    if (!window.confirm(`Terminate ${agent.agentName}? Its current task will stop and cannot be resumed.`)) return;
    void terminateAgent(agent.id).catch((cause) => setStatusMessage(cause instanceof Error ? cause.message : "Unable to terminate the agent."));
  }

  async function installManifest(manifest: unknown) {
    const result = await execute({ type: "install-manifest", manifest });
    setStatusMessage(result.message);
  }

  async function addScopeRule(rule: { kind: "host" | "domain" | "cidr" | "url-prefix" | "repository"; value: string; action: "allow" | "deny" }) {
    if (!dashboard) return;
    const result = await execute({ type: "add-scope-rule", projectId: dashboard.engagement.id, rule });
    setStatusMessage(result.message);
  }

  async function removeScopeRule(ruleId: string) {
    if (!dashboard) return;
    const result = await execute({ type: "remove-scope-rule", projectId: dashboard.engagement.id, ruleId });
    setStatusMessage(result.message);
  }

  async function createEngagement(input: { name: string; target: string }) {
    const result = await execute({ type: "create-project", ...input });
    setPageView("evaluation"); setActiveView("topology"); setSelectedAgentId(""); setSelectedNode(null); setSelectedFinding(null);
    setStatusMessage(result.message);
  }

  async function switchProject(projectId: string) {
    const result = await execute({ type: "switch-project", projectId });
    setSelectedNode(null); setSelectedFinding(null); setSearchQuery(""); setPageView("evaluation"); setActiveView("topology");
    setStatusMessage(result.message);
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
      <div className="sr-only" role="status">{searchResultMessage}</div>
      {statusMessage ? <div className="status-toast"><span>{statusMessage}</span><button aria-label="Dismiss message" onClick={() => setStatusMessage("")}><X size={16} aria-hidden="true" /></button></div> : null}
      <header className="topbar">
        <a className="brand" href="/" aria-label="HiveSwarm home"><HiveMark small /><span>HiveSwarm</span><small>alpha</small></a>
        <button className="breadcrumbs project-trigger" aria-label={`Switch project, current project ${dashboard.engagement.name}`} onClick={() => setProjectSwitcherOpen(true)}><span>Projects</span><span aria-hidden="true">/</span><strong>{dashboard.engagement.name}</strong><ChevronDown size={14} aria-hidden="true" /></button>
        <div className="topbar__actions">
          <span className="environment-switch"><span className="status__dot" aria-hidden="true" />Local workspace</span>
          <span className="avatar" aria-label="Signed in as Sma Das">SD</span>
        </div>
      </header>

      <ResizablePanelGroup
        className="app-panes"
        orientation="horizontal"
        resizeTargetMinimumSize={{ fine: 12, coarse: 36 }}
      >
      <ResizablePanel id="navigation" defaultSize="15rem" minSize="11rem" maxSize="24rem">
      <aside className="sidebar" aria-label="Workspace navigation">
        <button className="sidebar-project" onClick={() => setProjectSwitcherOpen(true)}><span className="sidebar-project__mark"><Hexagon size={16} aria-hidden="true" /></span><span><small>Current project</small><strong>{dashboard.engagement.name}</strong></span><ChevronDown size={14} aria-hidden="true" /></button>
        <nav className="primary-nav" aria-label="Primary">
          <button className={`nav-item ${pageView === "evaluation" ? "is-active" : ""}`} aria-current={pageView === "evaluation" ? "page" : undefined} onClick={() => { setPageView("evaluation"); setActiveView("topology"); }}><LayoutDashboard size={17} strokeWidth={1.5} aria-hidden="true" />Evaluation</button>
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

        <div className="utility-nav"><button className="nav-item" onClick={() => setEngagementOpen(true)}><Plus size={17} strokeWidth={1.5} aria-hidden="true" />New project</button></div>
      </aside>
      </ResizablePanel>

      <ResizableHandle withHandle aria-label="Resize navigation pane" />

      <ResizablePanel id="workspace" minSize="26rem">
      <main className="workspace" id="main">
        <details className="responsive-agent-controls">
          <summary>
            <span className="responsive-agent-controls__identity"><Bot size={17} strokeWidth={1.5} aria-hidden="true" /><span><small>Agent controls</small><strong>{selectedAgent?.agentName ?? "Select a specialist"}</strong></span></span>
            {selectedAgent ? <Status value={selectedAgent.status} /> : null}
            <ChevronDown className="responsive-agent-controls__chevron" size={16} aria-hidden="true" />
          </summary>
          <div className="responsive-agent-controls__body">
            <label htmlFor="responsive-agent-select">Specialist</label>
            <select id="responsive-agent-select" value={selectedAgentId} onChange={(event) => { setSelectedAgentId(event.target.value); setSelectedNode(null); }}>
              {dashboard.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.agentName} — {agent.status.replaceAll("_", " ")}</option>)}
            </select>
            {selectedAgent ? <AgentSelectionCard agent={selectedAgent} onTerminate={() => requestAgentTermination(selectedAgent)} /> : <p className="empty-copy">No specialist executions are available.</p>}
          </div>
        </details>

        {pageView === "evaluation" || pageView === "findings" ? <>
        <section className="workspace-header" aria-labelledby="page-title">
          <div className="workspace-heading">
            <div className="target-mark"><Hexagon size={21} strokeWidth={1.5} aria-hidden="true" /></div>
            <div><div className="title-line"><h1 id="page-title">{dashboard.engagement.name}</h1><Status value={dashboard.engagement.status === "waiting_approval" || dashboard.engagement.status === "paused" ? "paused" : "active"} /></div><p><bdi>{dashboard.engagement.target}</bdi><span aria-hidden="true">·</span>Started {relativeTime(dashboard.engagement.startedAt)}</p></div>
          </div>
          <div className="workspace-actions">
            <button className="button button--quiet" onClick={() => void toggleRun()}><CircleDotDashed size={16} strokeWidth={1.5} aria-hidden="true" />{dashboard.engagement.status === "paused" ? "Resume run" : "Pause run"}</button>
            <button className="button button--quiet mobile-specialist-action" onClick={() => setSpawnOpen(true)}><Plus size={16} strokeWidth={2} aria-hidden="true" />Start specialist</button>
            <button className="button button--primary" disabled={orchestrating || dashboard.engagement.status === "paused"} onClick={() => void runOrchestrator()}><Play size={16} strokeWidth={2} aria-hidden="true" />{orchestrating ? "Orchestrating" : "Run orchestrator"}</button>
          </div>
        </section>

        {pendingApproval ? <section className="responsive-approval" aria-label="Pending human decision">
          <ApprovalCard approval={pendingApproval} busy={decisionBusy} onDecision={(decision) => void decide(decision)} />
        </section> : null}

        <section className="metric-strip" aria-label="Evaluation summary">
          <div><span>Active agents</span><strong>{dashboard.metrics.activeAgents}</strong><small>{dashboard.agents.length} total executions</small></div>
          <div><span>Mapped assets</span><strong>{dashboard.metrics.assets}</strong><small>{dashboard.graph.edges.length} relationships</small></div>
          <div><span>Findings</span><strong>{dashboard.metrics.findings}</strong><small className="risk-copy">{criticalCount} high priority</small></div>
          <div><span>Scope decisions</span><strong>{dashboard.metrics.pendingApprovals}</strong><small>{dashboard.engagement.scopeRules.length} active rules</small></div>
        </section>

        <section className="evidence-panel" aria-label="Evaluation evidence">
          <div className="evidence-toolbar">
            <div className="view-switch" aria-label="Evidence view">
              <button aria-pressed={pageView === "evaluation" && activeView === "topology"} onClick={() => { setPageView("evaluation"); setActiveView("topology"); }}><Network size={15} strokeWidth={1.5} aria-hidden="true" />Topology</button>
              <button aria-pressed={pageView === "evaluation" && activeView === "swarm"} onClick={() => { setPageView("evaluation"); setActiveView("swarm"); }}><GitFork size={15} strokeWidth={1.5} aria-hidden="true" />Swarm</button>
              <button aria-pressed={pageView === "evaluation" && activeView === "scope"} onClick={() => { setPageView("evaluation"); setActiveView("scope"); }}><Waypoints size={15} strokeWidth={1.5} aria-hidden="true" />Scope map</button>
              <button aria-pressed={pageView === "findings" || activeView === "findings"} onClick={() => { setPageView("findings"); setActiveView("findings"); }}><FileSearch size={15} strokeWidth={1.5} aria-hidden="true" />Findings <span>{dashboard.findings.length}</span></button>
              <button aria-pressed={pageView === "evaluation" && activeView === "activity"} onClick={() => { setPageView("evaluation"); setActiveView("activity"); }}><Activity size={15} strokeWidth={1.5} aria-hidden="true" />Activity</button>
            </div>
            <div className="toolbar-actions">
              {activeView !== "scope" ? <div className="search-control"><Search size={15} strokeWidth={1.5} aria-hidden="true" /><label className="sr-only" htmlFor="evidence-search">Search evidence</label><input id="evidence-search" type="search" placeholder="Search evidence" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />{searchQuery ? <button className="search-control__clear" aria-label="Clear evidence search" onClick={() => setSearchQuery("")}><X size={14} aria-hidden="true" /></button> : null}</div> : null}
            </div>
          </div>

          {pageView !== "findings" && activeView === "topology" && normalizedQuery && !visibleNodes.length ? (
            <FilteredEmpty query={searchQuery.trim()} noun="assets" onClear={() => setSearchQuery("")} />
          ) : pageView !== "findings" && activeView === "topology" ? (
            <div className="graph-wrap">
              <SecurityGraph nodes={visibleNodes} edges={visibleEdges} layoutId={dashboard.engagement.id} selectedId={selectedNode?.id} onSelect={selectGraphNode} />
            </div>
          ) : pageView !== "findings" && activeView === "swarm" && normalizedQuery && !visibleAgents.length && !visibleFindings.length ? (
            <FilteredEmpty query={searchQuery.trim()} noun="swarm items" onClear={() => setSearchQuery("")} />
          ) : pageView !== "findings" && activeView === "swarm" ? (
            <div className="graph-wrap">
              <SwarmGraph agents={normalizedQuery ? visibleAgents : dashboard.agents} findings={visibleFindings} layoutId={dashboard.engagement.id} selectedId={selectedFinding ? `swarm-${selectedFinding.id}` : selectedAgentId} onSelectAgent={(agentRunId) => { setSelectedAgentId(agentRunId); setSelectedNode(null); }} onSelectFinding={setSelectedFinding} />
            </div>
          ) : pageView !== "findings" && activeView === "scope" ? (
            <div className="graph-wrap">
              <ScopeGraph dashboard={dashboard} selectedId={selectedNode?.id} onSelect={setSelectedNode} />
            </div>
          ) : pageView === "findings" || activeView === "findings" ? (
            <div className="finding-table" id="findings">
              <div className="finding-table__head"><span>Finding</span><span>Asset</span><span>Confidence</span><span>Status</span></div>
              {visibleFindings.map((finding) => (
                <button className="finding-row" key={finding.id} onClick={() => setSelectedFinding(finding)}>
                  <div><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p>{finding.summary}</p></div>
                  <span className="finding-row__field"><small>Asset</small><bdi>{finding.assetLabel}</bdi></span>
                  <span className="finding-row__field"><small>Confidence</small><span className="numeric">{Math.round(finding.confidence * 100)}%</span></span>
                  <span className="finding-row__field"><small>Status</small><span>{finding.status}</span></span>
                </button>
              ))}
              {normalizedQuery && !visibleFindings.length ? <FilteredEmpty query={searchQuery.trim()} noun="findings" onClear={() => setSearchQuery("")} /> : null}
            </div>
          ) : (
            <div className="activity-feed">
              {visibleLogs.map((log) => {
                const owner = dashboard.agents.find((agent) => agent.id === log.agentRunId)?.agentName ?? "Agent";
                return <article className={`log-row log-row--${log.level}`} key={log.id}><span className="log-row__time">{relativeTime(log.timestamp)}</span><span className="log-row__agent">{owner}</span><p>{log.message}</p></article>;
              })}
              {normalizedQuery && !visibleLogs.length ? <FilteredEmpty query={searchQuery.trim()} noun="events" onClear={() => setSearchQuery("")} /> : null}
            </div>
          )}
        </section>
        </> : pageView === "registry" ? (
          <RegistryView agents={agents} onInstall={installManifest} />
        ) : pageView === "scope" ? (
          <ScopeView dashboard={dashboard} selectedNodeId={selectedNode?.id} onAdd={addScopeRule} onRemove={removeScopeRule} onInspect={setSelectedNode} />
        ) : (
          <ReportView report={report} loading={reportLoading} apiUrl={apiUrl} projectId={dashboard.engagement.id} />
        )}
      </main>
      </ResizablePanel>

      <ResizableHandle className="inspector-handle" withHandle aria-label="Resize details pane" />

      <ResizablePanel className="inspector-pane" id="details" defaultSize="20.5rem" minSize="15rem" maxSize="30rem">
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
            <AgentSelectionCard agent={selectedAgent} onTerminate={() => requestAgentTermination(selectedAgent)} />
          ) : <p className="empty-copy">Select an agent or graph node to inspect its evidence and state.</p>}
        </section>

        <section className="inspector-section" aria-labelledby="recent-title">
          <div className="section-label"><h2 id="recent-title">Priority findings</h2><button onClick={() => { setPageView("findings"); setActiveView("findings"); }}>View all findings</button></div>
          <div className="priority-list">
            {sortedFindings.slice(0, 3).map((finding) => <button key={finding.id} onClick={() => setSelectedFinding(finding)}><SeverityBadge severity={finding.severity} /><strong>{finding.title}</strong><p><bdi>{finding.assetLabel}</bdi> · {relativeTime(finding.createdAt)}</p></button>)}
          </div>
        </section>
      </aside>
      </ResizablePanel>
      </ResizablePanelGroup>

      <SpawnDialog open={spawnOpen} agents={agents} parentAgents={dashboard.agents} target={dashboard.engagement.target} onClose={() => setSpawnOpen(false)} onSpawn={spawn} />
      <EngagementDialog open={engagementOpen} onClose={() => setEngagementOpen(false)} onCreate={createEngagement} />
      <ProjectSwitcher open={projectSwitcherOpen} projects={projects} activeProjectId={activeProjectId} onClose={() => setProjectSwitcherOpen(false)} onSelect={switchProject} onNew={() => setEngagementOpen(true)} />
      <FindingDrawer finding={selectedFinding} dashboard={dashboard} onClose={() => setSelectedFinding(null)} />
    </div>
  );
}
