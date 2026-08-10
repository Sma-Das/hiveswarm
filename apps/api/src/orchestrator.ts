import {
  agentEventSchema,
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

export class OrchestratorService {
  private readonly policy = new PolicyEngine();

  constructor(
    private readonly store: StateStore,
    private readonly registry: AgentRegistry,
    private readonly executor: ExecutionDriver,
    private readonly events: EventBus,
  ) {}

  async spawn(request: SpawnAgentRequest): Promise<{ agentRun: AgentRun; approvalRequired: boolean }> {
    const dashboard = await this.store.getDashboard();
    const manifest = await this.registry.get(request.agentId);
    if (!manifest) throw new Error(`Agent ${request.agentId} is not installed or enabled.`);
    const decision = this.policy.evaluate(dashboard, manifest, request);
    const parent = request.parentAgentRunId ?? null;
    const depth = decision.allowed
      ? decision.depth
      : (parent ? (dashboard.agents.find((agent) => agent.id === parent)?.depth ?? 0) + 1 : 1);
    const agentRun: AgentRun = {
      id: id("ar"), runId: "run_demo", parentAgentRunId: parent, agentId: manifest.id, agentName: manifest.name,
      lifecycle: request.lifecycle, status: decision.allowed ? "queued" : "waiting_approval", depth,
      task: request.task, target: request.target, startedAt: null, completedAt: null, logCount: 0,
    };

    if (!decision.allowed && !decision.approvalType) throw new Error(decision.reason);
    dashboard.agents.push(agentRun);
    if (!decision.allowed) {
      dashboard.approvals.unshift({
        id: id("approval"), runId: agentRun.runId, agentRunId: agentRun.id,
        type: decision.approvalType!, status: "pending", title: `Approve ${manifest.name} action`,
        rationale: decision.reason, requestedAction: `${request.task} Target: ${request.target}`,
        requestedBy: request.parentAgentRunId
          ? dashboard.agents.find((agent) => agent.id === request.parentAgentRunId)?.agentName ?? "Orchestrator"
          : "Orchestrator",
        createdAt: new Date().toISOString(),
      });
      dashboard.engagement.status = "waiting_approval";
    }
    this.refreshMetrics(dashboard);
    await this.store.saveDashboard(dashboard);
    await this.store.appendAudit({ id: id("audit"), actor: "orchestrator", action: "agent.spawn.requested", resource: agentRun.id, detail: request, createdAt: new Date().toISOString() });
    this.events.publish({ id: id("evt"), type: decision.allowed ? "agent.queued" : "approval.requested", runId: agentRun.runId, occurredAt: new Date().toISOString(), data: { agentRunId: agentRun.id } });
    if (decision.allowed) await this.executor.dispatch(agentRun);
    return { agentRun, approvalRequired: !decision.allowed };
  }

  async decideApproval(approvalId: string, decision: "approved" | "denied", note?: string) {
    const dashboard = await this.store.getDashboard();
    const approval = dashboard.approvals.find((item) => item.id === approvalId);
    if (!approval || approval.status !== "pending") throw new Error("Pending approval not found.");
    approval.status = decision;
    const agentRun = approval.agentRunId ? dashboard.agents.find((agent) => agent.id === approval.agentRunId) : undefined;
    if (agentRun) agentRun.status = decision === "approved" ? "queued" : "terminated";
    dashboard.engagement.status = dashboard.approvals.some((item) => item.status === "pending") ? "waiting_approval" : "running";
    this.refreshMetrics(dashboard);
    await this.store.saveDashboard(dashboard);
    await this.store.appendAudit({ id: id("audit"), actor: "human", action: `approval.${decision}`, resource: approvalId, detail: { note: note ?? "" }, createdAt: new Date().toISOString() });
    this.events.publish({ id: id("evt"), type: `approval.${decision}`, runId: approval.runId, occurredAt: new Date().toISOString(), data: { approvalId } });
    if (decision === "approved" && agentRun) await this.executor.dispatch(agentRun);
    return approval;
  }

  async ingest(agentRunId: string, input: unknown) {
    const event = agentEventSchema.parse(input);
    const dashboard = await this.store.getDashboard();
    const agentRun = dashboard.agents.find((agent) => agent.id === agentRunId);
    if (!agentRun) throw new Error("Agent execution not found.");
    this.applyEvent(dashboard, agentRun, event);
    this.refreshMetrics(dashboard);
    await this.store.saveDashboard(dashboard);
    this.events.publish({ id: id("evt"), type: `agent.${event.type}`, runId: agentRun.runId, occurredAt: new Date().toISOString(), data: { agentRunId } });
    return event;
  }

  async complete(agentRunId: string, outcome: "completed" | "failed", message?: string) {
    const dashboard = await this.store.getDashboard();
    const agentRun = dashboard.agents.find((agent) => agent.id === agentRunId);
    if (!agentRun) throw new Error("Agent execution not found.");
    agentRun.status = outcome;
    agentRun.completedAt = new Date().toISOString();
    if (message) {
      dashboard.logs.unshift({ id: id("log"), agentRunId, level: outcome === "failed" ? "error" : "info", message, timestamp: agentRun.completedAt });
      agentRun.logCount += 1;
    }
    this.refreshMetrics(dashboard);
    await this.store.saveDashboard(dashboard);
    this.events.publish({ id: id("evt"), type: `agent.${outcome}`, runId: agentRun.runId, occurredAt: agentRun.completedAt, data: { agentRunId } });
    return agentRun;
  }

  private applyEvent(dashboard: Dashboard, agentRun: AgentRun, event: AgentEvent) {
    const timestamp = new Date().toISOString();
    if (event.type === "log") {
      dashboard.logs.unshift({ id: id("log"), agentRunId: agentRun.id, level: event.level, message: event.message, timestamp });
      agentRun.logCount += 1;
    } else if (event.type === "node") {
      dashboard.graph.nodes.push({ ...event.node, id: id("node"), createdAt: timestamp });
    } else if (event.type === "edge") {
      dashboard.graph.edges.push({ ...event.edge, id: id("edge") });
    } else if (event.type === "finding") {
      dashboard.findings.unshift({ ...event.finding, id: id("finding"), createdAt: timestamp });
    } else {
      dashboard.approvals.unshift({
        id: id("approval"), runId: agentRun.runId, agentRunId: agentRun.id, type: "scope_expansion", status: "pending",
        title: `Review ${event.value}`, rationale: event.rationale, requestedAction: `Add ${event.value} as an allowed ${event.kind}.`,
        requestedBy: agentRun.agentName, createdAt: timestamp,
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
