import {
  agentManifestSchema,
  dashboardSchema,
  projectSummarySchema,
  type Dashboard,
  type ProjectSummary,
  type SpawnAgentRequest,
} from "@hiveswarm/contracts";

type FetchAdapter = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type EventSubscription = { close(): void };
type EventSourceAdapter = EventSubscription & {
  onmessage: ((event: MessageEvent) => void) | null;
  addEventListener(type: string, listener: EventListener): void;
};

export type WorkspaceSnapshot = {
  dashboard: Dashboard;
  agents: ReturnType<typeof agentManifestSchema.parse>[];
  projects: ProjectSummary[];
  activeProjectId: string;
};

export type WorkspaceCommand =
  | { type: "decide"; approvalId: string; decision: "approved" | "denied" }
  | { type: "spawn"; runId: string; request: SpawnAgentRequest }
  | { type: "set-run-state"; runId: string; status: "running" | "paused" }
  | { type: "orchestrate"; runId: string }
  | { type: "terminate-agent"; agentRunId: string }
  | { type: "install-manifest"; manifest: unknown }
  | { type: "add-scope-rule"; projectId: string; rule: { kind: "host" | "domain" | "cidr" | "url-prefix" | "repository"; value: string; action: "allow" | "deny" } }
  | { type: "remove-scope-rule"; projectId: string; ruleId: string }
  | { type: "create-project"; name: string; target: string }
  | { type: "switch-project"; projectId: string };

export type WorkspaceCommandResult = { message: string; projectId?: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The orchestration API returned an invalid response.");
  return value as Record<string, unknown>;
}

export class WorkspaceClient {
  private generation = 0;

  constructor(
    private readonly apiUrl: string,
    private readonly fetchAdapter: FetchAdapter = fetch,
    private readonly eventSourceFactory: (url: string) => EventSourceAdapter = (url) => new EventSource(url),
  ) {}

  async load(projectId?: string): Promise<WorkspaceSnapshot | undefined> {
    const generation = ++this.generation;
    const projectQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    let responses: [Response, Response, Response];
    try {
      responses = await Promise.all([
        this.fetchAdapter(`${this.apiUrl}/api/dashboard${projectQuery}`, { cache: "no-store" }),
        this.fetchAdapter(`${this.apiUrl}/api/agents`, { cache: "no-store" }),
        this.fetchAdapter(`${this.apiUrl}/api/projects`, { cache: "no-store" }),
      ]);
    } catch (error) {
      if (generation !== this.generation) return undefined;
      throw error;
    }
    if (generation !== this.generation) return undefined;
    const [dashboardResponse, agentsResponse, projectsResponse] = responses;
    if (!dashboardResponse.ok || !agentsResponse.ok || !projectsResponse.ok) throw new Error("The orchestration API is unavailable.");
    const dashboard = dashboardSchema.parse(await dashboardResponse.json());
    const agentPayload = record(await agentsResponse.json());
    const projectPayload = record(await projectsResponse.json());
    const agents = agentManifestSchema.array().parse(agentPayload.agents);
    const projects = projectSummarySchema.array().parse(projectPayload.projects);
    if (typeof projectPayload.activeProjectId !== "string") throw new Error("The orchestration API returned an invalid project workspace.");
    return { dashboard, agents, projects, activeProjectId: projectPayload.activeProjectId };
  }

  subscribe(runId: string, onChange: () => void): EventSubscription {
    const source = this.eventSourceFactory(`${this.apiUrl}/api/runs/${encodeURIComponent(runId)}/events`);
    source.onmessage = onChange;
    ["agent.started", "agent.queued", "agent.completed", "agent.failed", "agent.terminated", "approval.requested", "approval.approved", "approval.denied", "agent.log", "agent.node", "agent.edge", "agent.finding", "agent.artifact", "agent.scope_proposal", "run.paused", "run.running"]
      .forEach((eventName) => source.addEventListener(eventName, onChange as EventListener));
    return source;
  }

  async execute(command: WorkspaceCommand): Promise<WorkspaceCommandResult> {
    if (command.type === "decide") {
      await this.request(`/api/approvals/${encodeURIComponent(command.approvalId)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: command.decision }) });
      return { message: command.decision === "approved" ? "The request was approved once." : "The request was denied." };
    }
    if (command.type === "spawn") {
      const payload = record(await this.request(`/api/runs/${encodeURIComponent(command.runId)}/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.request) }));
      return { message: payload.approvalRequired === true ? "The specialist is waiting for approval." : "The specialist is starting." };
    }
    if (command.type === "set-run-state") {
      await this.request(`/api/runs/${encodeURIComponent(command.runId)}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: command.status }) });
      return { message: command.status === "paused" ? "The evaluation is paused." : "The evaluation is running." };
    }
    if (command.type === "orchestrate") {
      const payload = record(await this.request(`/api/runs/${encodeURIComponent(command.runId)}/orchestrate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }));
      return { message: `The orchestrator started ${Array.isArray(payload.spawned) ? payload.spawned.length : 0} specialists.` };
    }
    if (command.type === "terminate-agent") {
      await this.request(`/api/agent-runs/${encodeURIComponent(command.agentRunId)}/terminate`, { method: "POST" });
      return { message: "The agent was terminated." };
    }
    if (command.type === "install-manifest") {
      await this.request("/api/agents/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command.manifest) });
      return { message: "The agent manifest was installed." };
    }
    if (command.type === "add-scope-rule") {
      await this.request("/api/scope/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...command.rule, projectId: command.projectId }) });
      return { message: "The scope rule was added.", projectId: command.projectId };
    }
    if (command.type === "remove-scope-rule") {
      await this.request(`/api/scope/rules/${encodeURIComponent(command.ruleId)}?projectId=${encodeURIComponent(command.projectId)}`, { method: "DELETE" });
      return { message: "The scope rule was removed.", projectId: command.projectId };
    }
    if (command.type === "create-project") {
      const normalized = command.target.includes("://") ? new URL(command.target).hostname : command.target;
      const kind = command.target.startsWith("repository:") ? "repository" : "host";
      const payload = record(await this.request("/api/engagements", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: command.name, target: command.target, scopeRules: [{ id: "scope_primary", kind, value: kind === "repository" ? command.target : normalized, action: "allow" }] }),
      }));
      const engagement = record(payload.engagement);
      if (typeof engagement.id !== "string") throw new Error("The orchestration API returned an invalid project.");
      return { message: "The project was created. Run the orchestrator when you are ready.", projectId: engagement.id };
    }
    await this.request(`/api/projects/${encodeURIComponent(command.projectId)}/activate`, { method: "POST" });
    return { message: "Project switched.", projectId: command.projectId };
  }

  async loadReport(projectId: string): Promise<unknown> {
    return this.request(`/api/reports/current?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchAdapter(`${this.apiUrl}${path}`, init);
    if (!response.ok) {
      let message = "The orchestration API rejected the request.";
      try {
        const payload = record(await response.json());
        if (typeof payload.error === "string") message = payload.error;
      } catch {}
      throw new Error(message);
    }
    if (response.status === 204) return {};
    return response.json();
  }
}
