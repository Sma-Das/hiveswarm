import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceClient, type WorkspaceCommandResult, type WorkspaceSnapshot } from "./workspace-client";
import { useProjectWorkspace } from "./use-project-workspace";

// Exercise the hook's async callbacks without a DOM or automatic effect scheduling.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return hooks.slots[index] ??= { current: initial };
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= initial;
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value; }];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));

function render() {
  hooks.cursor = 0;
  return useProjectWorkspace();
}

function snapshot(id: string): WorkspaceSnapshot {
  return {
    dashboard: {
      engagement: { id, name: id, target: `${id}.test`, status: "running", startedAt: "2026-08-10T00:00:00.000Z", scopeRules: [] },
      metrics: { activeAgents: 0, assets: 0, findings: 0, pendingApprovals: 0 },
      agents: [], findings: [], approvals: [], graph: { nodes: [], edges: [] }, logs: [], artifacts: [],
    },
    agents: [], projects: [], activeProjectId: "server-preference",
  };
}

describe("useProjectWorkspace command ownership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hooks.slots = [];
    hooks.cursor = 0;
    vi.spyOn(WorkspaceClient.prototype, "load").mockImplementation(async (id) => snapshot(id ?? "first"));
  });

  it.each(["add-scope-rule", "orchestrate"] as const)("does not navigate back after a background %s completes", async (type) => {
    let finish!: (result: WorkspaceCommandResult) => void;
    const pending = new Promise<WorkspaceCommandResult>((resolve) => { finish = resolve; });
    const execute = vi.spyOn(WorkspaceClient.prototype, "execute").mockImplementation(async (command) => {
      if (command.type === "switch-project") return { message: "switched", projectId: command.projectId };
      return pending;
    });
    await render().refresh("first");
    const command = type === "orchestrate"
      ? { type, runId: "first-run" }
      : { type, projectId: "first", rule: { kind: "host" as const, value: "first.test", action: "allow" as const } };
    const background = render().execute(command);
    await render().execute({ type: "switch-project", projectId: "second" });
    finish(type === "add-scope-rule" ? { message: "finished", projectId: "first" } : { message: "finished" });
    await background;
    expect(render().dashboard?.engagement.id).toBe("second");
    expect(render().activeProjectId).toBe("second");
    expect(execute).toHaveBeenCalledWith(command);
    expect(WorkspaceClient.prototype.load).toHaveBeenCalledTimes(2);
  });

  it("ignores an older navigation completion and blocks refreshes during navigation", async () => {
    let finish!: (result: WorkspaceCommandResult) => void;
    vi.spyOn(WorkspaceClient.prototype, "execute")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce({ message: "switched", projectId: "third" });
    await render().refresh();
    expect(render().dashboard?.engagement.id).toBe("first");
    expect(render().connection).toBe("connecting");
    const old = render().execute({ type: "create-project", name: "second", target: "second.test" });
    await render().refresh();
    expect(WorkspaceClient.prototype.load).toHaveBeenCalledTimes(1);
    await render().execute({ type: "switch-project", projectId: "third" });
    finish({ message: "created", projectId: "second" });
    await old;
    expect(render().dashboard?.engagement.id).toBe("third");
  });

  it("refreshes the visible project when a mutation explicitly owns another project", async () => {
    const execute = vi.spyOn(WorkspaceClient.prototype, "execute").mockResolvedValue({ message: "removed", projectId: "first" });
    await render().refresh("second");
    await render().execute({ type: "remove-scope-rule", projectId: "first", ruleId: "rule-first" });
    expect(execute).toHaveBeenCalledWith({ type: "remove-scope-rule", projectId: "first", ruleId: "rule-first" });
    expect(WorkspaceClient.prototype.load).toHaveBeenLastCalledWith("second");
    expect(render().dashboard?.engagement.id).toBe("second");
  });
});
