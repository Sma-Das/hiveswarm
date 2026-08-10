import type { AgentManifest, Dashboard, ProjectSummary } from "@hiveswarm/contracts";
import { Pool, type PoolClient } from "pg";
import { createDemoDashboard } from "./seed.js";

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type DashboardOwner =
  | { kind: "project"; id: string }
  | { kind: "run"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "approval"; id: string };

export type DashboardMutation<T> = (dashboard: Dashboard) => T;

function normalizeDashboard(dashboard: Dashboard): Dashboard {
  return {
    ...dashboard,
    artifacts: dashboard.artifacts ?? [],
    approvals: dashboard.approvals.map((approval) => ({ ...approval, context: approval.context ?? {} })),
  };
}

function summary(dashboard: Dashboard): ProjectSummary {
  return {
    id: dashboard.engagement.id,
    name: dashboard.engagement.name,
    target: dashboard.engagement.target,
    status: dashboard.engagement.status,
    startedAt: dashboard.engagement.startedAt,
    metrics: dashboard.metrics,
    agentCount: dashboard.agents.length,
  };
}

export interface StateStore {
  initialize(): Promise<void>;
  getDashboard(projectId?: string): Promise<Dashboard>;
  getDashboardForRun(runId: string): Promise<Dashboard>;
  getDashboardForAgent(agentRunId: string): Promise<Dashboard>;
  getDashboardForApproval(approvalId: string): Promise<Dashboard>;
  mutateDashboard<T>(owner: DashboardOwner, mutation: DashboardMutation<T>): Promise<T>;
  listProjects(): Promise<ProjectSummary[]>;
  getActiveProjectId(): Promise<string>;
  setActiveProject(projectId: string): Promise<void>;
  saveDashboard(dashboard: Dashboard): Promise<void>;
  listManifests(): Promise<AgentManifest[]>;
  upsertManifest(manifest: AgentManifest): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStore implements StateStore {
  private readonly dashboards = new Map<string, Dashboard>();
  private activeProjectId: string;
  private readonly manifests = new Map<string, AgentManifest>();
  readonly audit: AuditEvent[] = [];
  private mutationTail: Promise<void> = Promise.resolve();

  constructor() {
    const demo = createDemoDashboard();
    this.dashboards.set(demo.engagement.id, demo);
    this.activeProjectId = demo.engagement.id;
  }

  async initialize() {}

  async getDashboard(projectId = this.activeProjectId) {
    const dashboard = this.dashboards.get(projectId);
    if (!dashboard) throw new Error("Project not found.");
    return structuredClone(normalizeDashboard(dashboard));
  }

  async getDashboardForRun(runId: string) {
    const dashboard = [...this.dashboards.values()].find((item) => item.agents.some((agent) => agent.runId === runId));
    if (!dashboard) throw new Error("Run not found.");
    return structuredClone(normalizeDashboard(dashboard));
  }

  async getDashboardForAgent(agentRunId: string) {
    const dashboard = [...this.dashboards.values()].find((item) => item.agents.some((agent) => agent.id === agentRunId));
    if (!dashboard) throw new Error("Agent execution not found.");
    return structuredClone(normalizeDashboard(dashboard));
  }

  async getDashboardForApproval(approvalId: string) {
    const dashboard = [...this.dashboards.values()].find((item) => item.approvals.some((approval) => approval.id === approvalId));
    if (!dashboard) throw new Error("Approval not found.");
    return structuredClone(normalizeDashboard(dashboard));
  }

  async mutateDashboard<T>(owner: DashboardOwner, mutation: DashboardMutation<T>): Promise<T> {
    const previous = this.mutationTail;
    let release = () => {};
    this.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const dashboard = this.resolveOwnedDashboard(owner);
      const next = structuredClone(normalizeDashboard(dashboard));
      const result = mutation(next);
      this.dashboards.set(next.engagement.id, structuredClone(normalizeDashboard(next)));
      return structuredClone(result);
    } finally {
      release();
    }
  }

  private resolveOwnedDashboard(owner: DashboardOwner) {
    const dashboards = [...this.dashboards.values()];
    const dashboard = owner.kind === "project"
      ? this.dashboards.get(owner.id)
      : owner.kind === "run"
        ? dashboards.find((item) => item.agents.some((agent) => agent.runId === owner.id))
        : owner.kind === "agent"
          ? dashboards.find((item) => item.agents.some((agent) => agent.id === owner.id))
          : dashboards.find((item) => item.approvals.some((approval) => approval.id === owner.id));
    if (!dashboard) throw new Error(`${owner.kind[0]!.toUpperCase()}${owner.kind.slice(1)} not found.`);
    return dashboard;
  }

  async listProjects() {
    return [...this.dashboards.values()].map((item) => summary(normalizeDashboard(item))).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getActiveProjectId() { return this.activeProjectId; }

  async setActiveProject(projectId: string) {
    if (!this.dashboards.has(projectId)) throw new Error("Project not found.");
    this.activeProjectId = projectId;
  }

  async saveDashboard(dashboard: Dashboard) { this.dashboards.set(dashboard.engagement.id, structuredClone(normalizeDashboard(dashboard))); }
  async listManifests() { return [...this.manifests.values()].map((item) => structuredClone(item)); }
  async upsertManifest(manifest: AgentManifest) { this.manifests.set(`${manifest.id}@${manifest.version}`, structuredClone(manifest)); }
  async appendAudit(event: AuditEvent) { this.audit.push(structuredClone(event)); }
  async close() {}
}

export class PostgresStore implements StateStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, statement_timeout: 10_000 });
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS state_snapshots (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS agent_packages (
        package_key text PRIMARY KEY,
        agent_id text NOT NULL,
        version text NOT NULL,
        manifest jsonb NOT NULL,
        installed_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(agent_id, version)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id text PRIMARY KEY,
        actor text NOT NULL,
        action text NOT NULL,
        resource text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      );
    `);
    const projects = await this.pool.query<{ payload: Dashboard }>("SELECT payload FROM state_snapshots WHERE id LIKE 'dashboard:%' ORDER BY updated_at DESC");
    if (!projects.rowCount) {
      const legacy = await this.pool.query<{ payload: Dashboard }>("SELECT payload FROM state_snapshots WHERE id = 'dashboard'");
      await this.saveDashboard(normalizeDashboard(legacy.rows[0]?.payload ?? createDemoDashboard()));
    }
    const active = await this.pool.query("SELECT 1 FROM state_snapshots WHERE id = 'workspace'");
    if (!active.rowCount) {
      const first = (await this.listProjects())[0];
      if (!first) throw new Error("Unable to initialize the project workspace.");
      await this.pool.query("INSERT INTO state_snapshots (id, payload) VALUES ('workspace', $1::jsonb)", [JSON.stringify({ activeProjectId: first.id })]);
    }
  }

  private async allDashboards() {
    const result = await this.pool.query<{ payload: Dashboard }>("SELECT payload FROM state_snapshots WHERE id LIKE 'dashboard:%' ORDER BY updated_at DESC");
    return result.rows.map((row) => normalizeDashboard(row.payload));
  }

  private async ownedDashboard(client: PoolClient, owner: DashboardOwner, lock = false) {
    const suffix = lock ? " FOR UPDATE" : "";
    if (owner.kind === "project") {
      return client.query<{ id: string; payload: Dashboard }>(`SELECT id, payload FROM state_snapshots WHERE id = $1${suffix}`, [`dashboard:${owner.id}`]);
    }
    const collection = owner.kind === "approval" ? "approvals" : "agents";
    const field = owner.kind === "run" ? "runId" : "id";
    return client.query<{ id: string; payload: Dashboard }>(
      `SELECT id, payload FROM state_snapshots
       WHERE id LIKE 'dashboard:%'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(payload->'${collection}') AS item
           WHERE item->>'${field}' = $1
         )${suffix}`,
      [owner.id],
    );
  }

  async mutateDashboard<T>(owner: DashboardOwner, mutation: DashboardMutation<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await this.ownedDashboard(client, owner, true);
      const row = selected.rows[0];
      if (!row) throw new Error(`${owner.kind[0]!.toUpperCase()}${owner.kind.slice(1)} not found.`);
      const dashboard = normalizeDashboard(row.payload);
      const result = mutation(dashboard);
      await client.query("UPDATE state_snapshots SET payload = $1::jsonb, updated_at = now() WHERE id = $2", [JSON.stringify(normalizeDashboard(dashboard)), row.id]);
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveProjectId() {
    const result = await this.pool.query<{ active_project_id: string }>("SELECT payload->>'activeProjectId' AS active_project_id FROM state_snapshots WHERE id = 'workspace'");
    const projectId = result.rows[0]?.active_project_id;
    if (!projectId) throw new Error("No active project is configured.");
    return projectId;
  }

  async getDashboard(projectId?: string) {
    const resolvedId = projectId ?? await this.getActiveProjectId();
    const result = await this.pool.query<{ payload: Dashboard }>("SELECT payload FROM state_snapshots WHERE id = $1", [`dashboard:${resolvedId}`]);
    if (!result.rows[0]) throw new Error("Project not found.");
    return normalizeDashboard(result.rows[0].payload);
  }

  async getDashboardForRun(runId: string) {
    const dashboard = (await this.allDashboards()).find((item) => item.agents.some((agent) => agent.runId === runId));
    if (!dashboard) throw new Error("Run not found.");
    return dashboard;
  }

  async getDashboardForAgent(agentRunId: string) {
    const dashboard = (await this.allDashboards()).find((item) => item.agents.some((agent) => agent.id === agentRunId));
    if (!dashboard) throw new Error("Agent execution not found.");
    return dashboard;
  }

  async getDashboardForApproval(approvalId: string) {
    const dashboard = (await this.allDashboards()).find((item) => item.approvals.some((approval) => approval.id === approvalId));
    if (!dashboard) throw new Error("Approval not found.");
    return dashboard;
  }

  async listProjects() { return (await this.allDashboards()).map(summary).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

  async setActiveProject(projectId: string) {
    await this.getDashboard(projectId);
    await this.pool.query(
      `INSERT INTO state_snapshots (id, payload) VALUES ('workspace', $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [JSON.stringify({ activeProjectId: projectId })],
    );
  }

  async saveDashboard(dashboard: Dashboard) {
    await this.pool.query(
      `INSERT INTO state_snapshots (id, payload) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [`dashboard:${dashboard.engagement.id}`, JSON.stringify(normalizeDashboard(dashboard))],
    );
  }

  async listManifests() {
    const result = await this.pool.query<{ manifest: AgentManifest }>("SELECT manifest FROM agent_packages ORDER BY agent_id, version DESC");
    return result.rows.map((row) => row.manifest);
  }

  async upsertManifest(manifest: AgentManifest) {
    await this.pool.query(
      `INSERT INTO agent_packages (package_key, agent_id, version, manifest)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (package_key) DO UPDATE SET manifest = EXCLUDED.manifest, installed_at = now()`,
      [`${manifest.id}@${manifest.version}`, manifest.id, manifest.version, JSON.stringify(manifest)],
    );
  }

  async appendAudit(event: AuditEvent) {
    await this.pool.query(
      "INSERT INTO audit_events (id, actor, action, resource, detail, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)",
      [event.id, event.actor, event.action, event.resource, JSON.stringify(event.detail), event.createdAt],
    );
  }

  async close() { await this.pool.end(); }
}
