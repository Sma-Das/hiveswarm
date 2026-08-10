import type { Dashboard } from "@hiveswarm/contracts";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceClient } from "./workspace-client";

function dashboard(id: string): Dashboard {
  return {
    engagement: { id, name: `Project ${id}`, target: `${id}.example.test`, status: "running", startedAt: "2026-08-10T00:00:00.000Z", scopeRules: [{ id: `scope-${id}`, kind: "host", value: `${id}.example.test`, action: "allow" }] },
    metrics: { activeAgents: 0, assets: 0, findings: 0, pendingApprovals: 0 },
    agents: [], findings: [], approvals: [], graph: { nodes: [], edges: [] }, logs: [], artifacts: [],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("WorkspaceClient", () => {
  it("suppresses a late project response after a newer load", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstDashboard = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const fetchAdapter = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/dashboard?projectId=first")) return firstDashboard;
      if (url.includes("/api/dashboard?projectId=second")) return json(dashboard("second"));
      if (url.endsWith("/api/agents")) return json({ agents: [] });
      if (url.endsWith("/api/projects")) return json({ activeProjectId: "second", projects: [{ id: "second", name: "Project second", target: "second.example.test", status: "running", startedAt: "2026-08-10T00:00:00.000Z", metrics: { activeAgents: 0, assets: 0, findings: 0, pendingApprovals: 0 }, agentCount: 0 }] });
      throw new Error(`Unexpected request ${url}`);
    });
    const client = new WorkspaceClient("http://api", fetchAdapter);

    const staleLoad = client.load("first");
    const current = await client.load("second");
    resolveFirst(json(dashboard("first")));

    expect(current?.dashboard.engagement.id).toBe("second");
    await expect(staleLoad).resolves.toBeUndefined();
  });

  it("sends project ownership explicitly for scope mutations", async () => {
    const fetchAdapter = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({ rule: { id: "scope-new" } }, 201));
    const client = new WorkspaceClient("http://api", fetchAdapter);
    const result = await client.execute({ type: "add-scope-rule", projectId: "eng-owned", rule: { kind: "host", value: "api.example.test", action: "allow" } });
    const [url, init] = fetchAdapter.mock.calls[0]!;
    expect(url).toBe("http://api/api/scope/rules");
    expect(JSON.parse(init!.body as string)).toEqual(expect.objectContaining({ projectId: "eng-owned" }));
    expect(result.projectId).toBe("eng-owned");
  });

  it("validates workspace payloads at the transport seam", async () => {
    const fetchAdapter = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/dashboard")) return json({ engagement: { id: "invalid" } });
      if (url.endsWith("/api/agents")) return json({ agents: [] });
      return json({ activeProjectId: "invalid", projects: [] });
    });
    await expect(new WorkspaceClient("http://api", fetchAdapter).load("invalid")).rejects.toThrow();
  });
});
