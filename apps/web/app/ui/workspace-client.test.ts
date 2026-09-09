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
  it("coalesces event bursts and waits for an in-flight refresh", async () => {
    vi.useFakeTimers();
    try {
      const source = { onmessage: null as (() => void) | null, addEventListener: vi.fn(), close: vi.fn() };
      let finish!: () => void;
      const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
      const client = new WorkspaceClient("http://api", vi.fn(), () => source);
      const subscription = client.subscribe("run", refresh);
      for (let i = 0; i < 1000; i++) source.onmessage?.();
      await vi.advanceTimersByTimeAsync(250);
      expect(refresh).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 1000; i++) source.onmessage?.();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refresh).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(250);
      expect(refresh).toHaveBeenCalledTimes(2);
      subscription.close();
      finish();
      source.onmessage?.();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(source.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a queued refresh when the subscription closes", async () => {
    vi.useFakeTimers();
    try {
      const source = { onmessage: null as (() => void) | null, addEventListener: vi.fn(), close: vi.fn() };
      const refresh = vi.fn();
      const subscription = new WorkspaceClient("http://api", vi.fn(), () => source).subscribe("run", refresh);
      source.onmessage?.();
      subscription.close();
      await vi.advanceTimersByTimeAsync(1000);
      expect(refresh).not.toHaveBeenCalled();
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

  it("aborts superseded requests and cancels pending loads on unmount", async () => {
    const signals: AbortSignal[] = [];
    const fetchAdapter = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init!.signal!;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const client = new WorkspaceClient("http://api", fetchAdapter);
    const first = client.load("first");
    const second = client.load("second");
    expect(signals.slice(0, 3).every((signal) => signal.aborted)).toBe(true);
    expect(signals.slice(3).every((signal) => !signal.aborted)).toBe(true);
    client.cancelLoad();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("suppresses a project switch that happens while a response body is being read", async () => {
    let resolveBody!: (value: Dashboard) => void;
    const body = new Promise<Dashboard>((resolve) => { resolveBody = resolve; });
    const firstResponse = json({});
    const readBody = vi.spyOn(firstResponse, "json").mockReturnValue(body);
    const fetchAdapter = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("projectId=first")) return firstResponse;
      if (url.includes("/api/dashboard")) return json(dashboard("second"));
      if (url.endsWith("/api/agents")) return json({ agents: [] });
      return json({ activeProjectId: "second", projects: [] });
    });
    const client = new WorkspaceClient("http://api", fetchAdapter);
    const first = client.load("first");
    await vi.waitFor(() => expect(readBody).toHaveBeenCalled());
    expect((await client.load("second"))?.dashboard.engagement.id).toBe("second");
    resolveBody(dashboard("first"));
    await expect(first).resolves.toBeUndefined();
  });
});
