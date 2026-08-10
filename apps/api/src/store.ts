import type { AgentManifest, Dashboard } from "@hiveswarm/contracts";
import { Pool } from "pg";
import { createDemoDashboard } from "./seed.js";

function normalizeDashboard(dashboard: Dashboard): Dashboard {
  return {
    ...dashboard,
    artifacts: dashboard.artifacts ?? [],
    approvals: dashboard.approvals.map((approval) => ({ ...approval, context: approval.context ?? {} })),
  };
}

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export interface StateStore {
  initialize(): Promise<void>;
  getDashboard(): Promise<Dashboard>;
  saveDashboard(dashboard: Dashboard): Promise<void>;
  listManifests(): Promise<AgentManifest[]>;
  upsertManifest(manifest: AgentManifest): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStore implements StateStore {
  private dashboard = createDemoDashboard();
  private readonly manifests = new Map<string, AgentManifest>();
  readonly audit: AuditEvent[] = [];

  async initialize() {}
  async getDashboard() { return structuredClone(normalizeDashboard(this.dashboard)); }
  async saveDashboard(dashboard: Dashboard) { this.dashboard = structuredClone(dashboard); }
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
    const current = await this.pool.query("SELECT 1 FROM state_snapshots WHERE id = 'dashboard'");
    if (current.rowCount === 0) await this.saveDashboard(createDemoDashboard());
  }

  async getDashboard() {
    const result = await this.pool.query<{ payload: Dashboard }>("SELECT payload FROM state_snapshots WHERE id = 'dashboard'");
    return normalizeDashboard(result.rows[0]?.payload ?? createDemoDashboard());
  }

  async saveDashboard(dashboard: Dashboard) {
    await this.pool.query(
      `INSERT INTO state_snapshots (id, payload) VALUES ('dashboard', $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [JSON.stringify(dashboard)],
    );
  }

  async listManifests() {
    const result = await this.pool.query<{ manifest: AgentManifest }>(
      "SELECT manifest FROM agent_packages ORDER BY agent_id, version DESC",
    );
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
