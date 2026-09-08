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
  it.each(["resolve", "reject"])("suppresses JSON parsing that finishes late: %s", async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    let started!: () => void;
    const parsing = new Promise<void>((yes) => { started = yes; });
    const client = new WorkspaceClient("http://api", async (input) => {
      const url = String(input);
      if (url.includes("projectId=first")) {
        const response = json({});
        response.json = () => { started(); return pending; };
        return response;
      }
      if (url.includes("/dashboard")) return json(dashboard("second"));
      if (url.endsWith("/agents")) return json({ agents: [] });
      return json({ activeProjectId: "second", projects: [] });
    });
    const stale = client.load("first");
    await parsing;
    expect((await client.load("second"))?.dashboard.engagement.id).toBe("second");
    if (outcome === "resolve") resolve(dashboard("first"));
    else reject(new Error("Late malformed JSON"));
    await expect(stale).resolves.toBeUndefined();
  });

  it("tracks SSE connectivity, coalesces bursts, and cancels queued refreshes on close", () => {
    vi.useFakeTimers();
    try {
      const listeners = new Map<string, EventListener>();
      const source = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn(), addEventListener: (type: string, listener: EventListener) => { listeners.set(type, listener); } };
      const change = vi.fn();
      const connection = vi.fn();
      const client = new WorkspaceClient("http://api", vi.fn(), () => source);
      const subscription = client.subscribe("run", change, connection);
      const emit = (name: string) => listeners.get(name)!(new Event(name));
      expect(connection).toHaveBeenLastCalledWith("connecting");
      emit("open");
      expect(connection).toHaveBeenLastCalledWith("connected");
      emit("agent.log");
      source.onmessage!(new MessageEvent("message"));
      vi.advanceTimersByTime(50);
      expect(change).toHaveBeenCalledTimes(1);
      emit("error");
      expect(connection).toHaveBeenLastCalledWith("reconnecting");
      emit("open");
      vi.advanceTimersByTime(50);
      expect(change).toHaveBeenCalledTimes(2);
      emit("agent.finding");
      subscription.close();
      emit("error");
      emit("open");
      vi.runAllTimers();
      expect(change).toHaveBeenCalledTimes(2);
      expect(connection.mock.calls.map(([state]) => state)).toEqual(["connecting", "connected", "reconnecting", "connected"]);
      expect(source.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

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
