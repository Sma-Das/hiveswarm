import {
  agentEventSchema,
  type AgentCapability,
  type AgentEvent,
  type AgentRun,
  type Dashboard,
  type SpawnAgentRequest,
} from "@hiveswarm/contracts";
import type { ExecutionDriver } from "./executor.js";
import type { EventBus } from "./events.js";
import { id } from "./id.js";
import { PolicyEngine } from "./policy.js";
import type { AgentRegistry } from "./registry.js";
import type { StateStore } from "./store.js";

function eventCapability(event: AgentEvent): AgentCapability | undefined {
  if (event.type === "node" || event.type === "edge") return "graph.write";
  if (event.type === "finding") return "finding.write";
  if (event.type === "scope_proposal") return "scope.propose";
  return undefined;
}

export class OrchestratorService {
  private readonly policy = new PolicyEngine();

  constructor(
    private readonly store: StateStore,
    private readonly registry: AgentRegistry,
    private readonly executor: ExecutionDriver,
    private readonly events: EventBus,
  ) {}

  async spawn(request: SpawnAgentRequest, runId: string): Promise<{ agentRun: AgentRun; approvalRequired: boolean }> {
    const manifest = await this.registry.get(request.agentId);
    if (!manifest) throw new Error(`Agent ${request.agentId} is not installed or enabled.`);
    const result = await this.store.mutateDashboard({ kind: "run", id: runId }, (dashboard) => {
      if (dashboard.engagement.status === "paused") throw new Error("The engagement is paused; resume it before starting another agent.");
      if (["completed", "failed", "cancelled"].includes(dashboard.engagement.status)) throw new Error("The engagement is not active.");
      const decision = this.policy.evaluate(dashboard, manifest, request);
      const parent = request.parentAgentRunId ?? null;
      const depth = decision.allowed
        ? decision.depth
        : (parent ? (dashboard.agents.find((agent) => agent.id === parent)?.depth ?? 0) + 1 : 1);
      const agentRun: AgentRun = {
        id: id("ar"), runId, parentAgentRunId: parent, agentId: manifest.id, agentName: manifest.name,
        lifecycle: request.lifecycle, status: decision.allowed ? "queued" : "waiting_approval", depth,
        task: request.task, target: request.target, requestedCapabilities: request.requestedCapabilities,
        executionPlan: request.executionPlan, startedAt: null, completedAt: null, logCount: 0,
      };
      if (!decision.allowed && !decision.approvalType) throw new Error(decision.reason);
      dashboard.agents.push(agentRun);
      if (!decision.allowed) {
        dashboard.approvals.unshift({
          id: id("approval"), runId: agentRun.runId, agentRunId: agentRun.id,
          type: decision.approvalType!, status: "pending", title: `Approve ${manifest.name} action`,
          rationale: decision.reason,
          requestedAction: request.executionPlan.length
            ? `${request.task} Target: ${request.target}\n\nCommand plan:\n${request.executionPlan.map((step, index) => `${index + 1}. ${step.label}: ${step.command}`).join("\n").slice(0, 8_000)}`
            : `${request.task} Target: ${request.target}`,
          requestedBy: request.parentAgentRunId
            ? dashboard.agents.find((agent) => agent.id === request.parentAgentRunId)?.agentName ?? "Orchestrator"
            : "Orchestrator",
          createdAt: new Date().toISOString(),
          context: { kind: "agent_spawn", requestedCapabilities: request.requestedCapabilities, executionPlan: request.executionPlan },
        });
        dashboard.engagement.status = "waiting_approval";
      }
      this.refreshMetrics(dashboard);
      return { agentRun, approvalRequired: !decision.allowed };
    });
    const { agentRun } = result;
    await this.store.appendAudit({ id: id("audit"), actor: "orchestrator", action: "agent.spawn.requested", resource: agentRun.id, detail: request, createdAt: new Date().toISOString() });
    this.events.publish({ id: id("evt"), type: result.approvalRequired ? "approval.requested" : "agent.queued", runId: agentRun.runId, occurredAt: new Date().toISOString(), data: { agentRunId: agentRun.id } });
    if (!result.approvalRequired) await this.executor.dispatch(agentRun);
    return result;
  }

  async decideApproval(approvalId: string, decision: "approved" | "denied", note?: string) {
    const result = await this.store.mutateDashboard({ kind: "approval", id: approvalId }, (dashboard) => {
      const wasPaused = dashboard.engagement.status === "paused";
      const approval = dashboard.approvals.find((item) => item.id === approvalId);
      if (!approval || approval.status !== "pending") throw new Error("Pending approval not found.");
      approval.status = decision;
      const agentRun = approval.agentRunId ? dashboard.agents.find((agent) => agent.id === approval.agentRunId) : undefined;
      const isScopeProposal = approval.context.kind === "scope_proposal";
      if (isScopeProposal && decision === "approved") {
        const kind = approval.context.scopeKind;
        const value = approval.context.scopeValue;
        if (typeof kind === "string" && typeof value === "string" && !dashboard.engagement.scopeRules.some((rule) => rule.action === "allow" && rule.kind === kind && rule.value === value)) {
          dashboard.engagement.scopeRules = dashboard.engagement.scopeRules.filter((rule) => !(rule.action === "deny" && rule.kind === kind && rule.value === value));
          dashboard.engagement.scopeRules.push({ id: id("scope"), kind: kind as "host" | "domain" | "cidr" | "url-prefix" | "repository", value, action: "allow" });
        }
        if (agentRun?.status === "waiting_approval") agentRun.status = "running";
      } else if (agentRun) {
        agentRun.status = decision === "approved" ? "queued" : "terminated";
        if (decision === "denied") agentRun.completedAt = new Date().toISOString();
      }
      dashboard.engagement.status = dashboard.approvals.some((item) => item.status === "pending") ? "waiting_approval" : wasPaused ? "paused" : "running";
      this.refreshMetrics(dashboard);
      return { approval, agentRun, isScopeProposal, wasPaused };
    });
    const { approval, agentRun, isScopeProposal, wasPaused } = result;
    await this.store.appendAudit({ id: id("audit"), actor: "human", action: `approval.${decision}`, resource: approvalId, detail: { note: note ?? "" }, createdAt: new Date().toISOString() });
    this.events.publish({ id: id("evt"), type: `approval.${decision}`, runId: approval.runId, occurredAt: new Date().toISOString(), data: { approvalId } });
    if (decision === "approved" && agentRun && !isScopeProposal && !wasPaused) await this.executor.dispatch(agentRun);
    return approval;
  }

  async ingest(agentRunId: string, input: unknown) {
    const event = agentEventSchema.parse(input);
    const agentRun = await this.store.mutateDashboard({ kind: "agent", id: agentRunId }, (dashboard) => {
      const current = dashboard.agents.find((agent) => agent.id === agentRunId)!;
      if (["completed", "failed", "terminated"].includes(current.status)) throw new Error("Agent execution is no longer active.");
      const requiredCapability = eventCapability(event);
      if (requiredCapability && !current.requestedCapabilities.includes(requiredCapability)) {
        throw new Error(`Agent execution is not authorized for ${requiredCapability} events.`);
      }
      if (current.status === "queued" || current.status === "starting") {
        current.status = "running";
        current.startedAt ??= new Date().toISOString();
      }
      if (event.type !== "spawn_request") this.applyEvent(dashboard, current, event);
      this.refreshMetrics(dashboard);
      return current;
    });
    if (event.type === "spawn_request") return this.spawn({ ...event.request, parentAgentRunId: agentRun.id }, agentRun.runId);
    this.events.publish({ id: id("evt"), type: `agent.${event.type}`, runId: agentRun.runId, occurredAt: new Date().toISOString(), data: { agentRunId } });
    return event;
  }

  async complete(agentRunId: string, outcome: "completed" | "failed", message?: string) {
    const result = await this.store.mutateDashboard({ kind: "agent", id: agentRunId }, (dashboard) => {
      const current = dashboard.agents.find((agent) => agent.id === agentRunId)!;
      if (current.status === "terminated") return { agentRun: current, occurredAt: null };
      current.status = outcome;
      const completedAt = new Date().toISOString();
      current.completedAt = completedAt;
      if (message) {
        dashboard.logs.unshift({ id: id("log"), agentRunId, level: outcome === "failed" ? "error" : "info", message, timestamp: completedAt });
        current.logCount += 1;
      }
      this.refreshMetrics(dashboard);
      return { agentRun: current, occurredAt: completedAt };
    });
    const { agentRun, occurredAt } = result;
    if (agentRun.status === "terminated") return agentRun;
    this.events.publish({ id: id("evt"), type: `agent.${outcome}`, runId: agentRun.runId, occurredAt: occurredAt!, data: { agentRunId } });
    return agentRun;
  }

  async terminate(agentRunId: string) {
    const result = await this.store.mutateDashboard({ kind: "agent", id: agentRunId }, (dashboard) => {
      const agentRun = dashboard.agents.find((agent) => agent.id === agentRunId)!;
      const alreadyTerminal = ["completed", "failed", "terminated"].includes(agentRun.status);
      if (!alreadyTerminal) {
        agentRun.status = "terminated";
        const completedAt = new Date().toISOString();
        agentRun.completedAt = completedAt;
        dashboard.logs.unshift({ id: id("log"), agentRunId, level: "warn", message: "Execution terminated by a human operator.", timestamp: completedAt });
        agentRun.logCount += 1;
        this.refreshMetrics(dashboard);
      }
      return { agentRun, alreadyTerminal, occurredAt: agentRun.completedAt };
    });
    const { agentRun, alreadyTerminal, occurredAt } = result;
    if (alreadyTerminal) return agentRun;
    await this.executor.terminate(agentRun);
    await this.store.appendAudit({ id: id("audit"), actor: "human", action: "agent.terminated", resource: agentRun.id, detail: {}, createdAt: occurredAt! });
    this.events.publish({ id: id("evt"), type: "agent.terminated", runId: agentRun.runId, occurredAt: occurredAt!, data: { agentRunId } });
    return agentRun;
  }

  async setRunState(runId: string, status: "running" | "paused") {
    const controllable = await this.store.mutateDashboard({ kind: "run", id: runId }, (dashboard) => {
      dashboard.engagement.status = status;
      return dashboard.agents.filter((agent) => ["running", "starting", "waiting_approval"].includes(agent.status));
    });
    await this.executor.controlRun(runId, status === "paused" ? "pause" : "resume", controllable.map((agent) => agent.id));
    if (status === "running") {
      const queuedAgents = await this.store.mutateDashboard({ kind: "run", id: runId }, (dashboard) => {
        const queued = dashboard.agents.filter((agent) => agent.status === "queued");
        for (const agent of queued) agent.status = "starting";
        this.refreshMetrics(dashboard);
        return queued;
      });
      for (const queued of queuedAgents) await this.executor.dispatch(queued);
    }
    await this.store.appendAudit({ id: id("audit"), actor: "human", action: `run.${status}`, resource: runId, detail: {}, createdAt: new Date().toISOString() });
    this.events.publish({ id: id("evt"), type: `run.${status}`, runId, occurredAt: new Date().toISOString(), data: {} });
    return { status };
  }

  private applyEvent(dashboard: Dashboard, agentRun: AgentRun, event: AgentEvent) {
    const timestamp = new Date().toISOString();
    if (event.type === "spawn_request") return;
    if (event.type === "log") {
      dashboard.logs.unshift({ id: id("log"), agentRunId: agentRun.id, level: event.level, message: event.message, timestamp });
      agentRun.logCount += 1;
    } else if (event.type === "node") {
      dashboard.graph.nodes.push({ ...event.node, id: id("node"), metadata: { ...event.node.metadata, ...(event.ref ? { agentRef: event.ref } : {}), agentRunId: agentRun.id }, createdAt: timestamp });
    } else if (event.type === "edge") {
      const resolveRef = (value: string) => dashboard.graph.nodes.find((node) => node.metadata.agentRunId === agentRun.id && node.metadata.agentRef === value)?.id ?? value;
      dashboard.graph.edges.push({ ...event.edge, source: resolveRef(event.edge.source), target: resolveRef(event.edge.target), id: id("edge") });
    } else if (event.type === "finding") {
      const findingId = id("finding");
      dashboard.findings.unshift({ ...event.finding, id: findingId, createdAt: timestamp });
      const findingNodeId = id("node");
      dashboard.graph.nodes.push({ id: findingNodeId, kind: "finding", label: event.finding.title, subtitle: event.finding.assetLabel, severity: event.finding.severity, status: event.finding.status, metadata: { findingId }, discoveredBy: event.finding.discoveredBy, createdAt: timestamp });
      const asset = dashboard.graph.nodes.find((node) => node.kind !== "finding" && (node.label === event.finding.assetLabel || node.metadata.url === event.finding.assetLabel));
      if (asset) dashboard.graph.edges.push({ id: id("edge"), source: asset.id, target: findingNodeId, relationship: "affected_by", metadata: {} });
    } else if (event.type === "artifact") {
      dashboard.artifacts.unshift({ ...event.artifact, id: id("artifact"), agentRunId: agentRun.id, createdAt: timestamp });
    } else {
      dashboard.approvals.unshift({
        id: id("approval"), runId: agentRun.runId, agentRunId: agentRun.id, type: "scope_expansion", status: "pending",
        title: `Review ${event.value}`, rationale: event.rationale, requestedAction: `Add ${event.value} as an allowed ${event.kind}.`,
        requestedBy: agentRun.agentName, createdAt: timestamp,
        context: { kind: "scope_proposal", scopeKind: event.kind, scopeValue: event.value },
      });
      agentRun.status = "waiting_approval";
      dashboard.engagement.status = "waiting_approval";
    }
  }

  private refreshMetrics(dashboard: Dashboard) {
    dashboard.metrics = {
      activeAgents: dashboard.agents.filter((agent) => agent.status === "running").length,
      assets: dashboard.graph.nodes.filter((node) => node.kind !== "finding" && node.kind !== "agent").length,
      findings: dashboard.findings.length,
      pendingApprovals: dashboard.approvals.filter((approval) => approval.status === "pending").length,
    };
  }
}
