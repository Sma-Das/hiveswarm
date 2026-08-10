import { agentManifestSchema } from "@hiveswarm/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "./events.js";
import type { ExecutionDriver } from "./executor.js";
import { OrchestratorService } from "./orchestrator.js";
import type { AgentRegistry } from "./registry.js";
import { MemoryStore } from "./store.js";

const manifest = agentManifestSchema.parse({
  schemaVersion: "1", id: "test-agent", name: "Test agent", version: "1.0.0",
  description: "A bounded specialist used to verify orchestration behavior.", role: "test", image: "test:latest", command: ["test"],
  lifecycle: ["task", "session"], capabilities: ["network.active", "scope.propose"], skills: [], accepts: [], emits: [], configuration: [], enabled: true, labels: {},
});

class RecordingExecutor implements ExecutionDriver {
  dispatched: string[] = [];
  terminated: string[] = [];
  controls: Array<{ action: "pause" | "resume"; agentRunIds: string[] }> = [];
  async dispatch(run: { id: string }) { this.dispatched.push(run.id); }
  async terminate(run: { id: string }) { this.terminated.push(run.id); }
  async controlRun(_runId: string, action: "pause" | "resume", agentRunIds: string[]) { this.controls.push({ action, agentRunIds }); }
}

describe("OrchestratorService", () => {
  let store: MemoryStore;
  let executor: RecordingExecutor;
  let service: OrchestratorService;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.initialize();
    const dashboard = await store.getDashboard();
    dashboard.approvals = [];
    dashboard.engagement.status = "running";
    await store.saveDashboard(dashboard);
    executor = new RecordingExecutor();
    const registry = { get: async (agentId: string) => agentId === manifest.id ? manifest : undefined, list: async () => [manifest] } as AgentRegistry;
    service = new OrchestratorService(store, registry, executor, new EventBus());
  });

  it("blocks new execution while the run is paused", async () => {
    const dashboard = await store.getDashboard();
    dashboard.engagement.status = "paused";
    await store.saveDashboard(dashboard);
    await expect(service.spawn({ agentId: manifest.id, lifecycle: "task", task: "Inspect the approved host safely", target: "app.northstar.test", requestedCapabilities: [] })).rejects.toThrow(/paused/i);
  });

  it("turns explorer scope proposals into human-approved allow rules without restarting the explorer", async () => {
    const before = executor.dispatched.length;
    await service.ingest("ar_explorer", { type: "scope_proposal", kind: "host", value: "files.northstar.test", rationale: "A rendered workflow links to the file service." });
    const pending = (await store.getDashboard()).approvals.find((approval) => approval.status === "pending" && approval.context.scopeValue === "files.northstar.test");
    expect(pending).toBeDefined();
    await service.decideApproval(pending!.id, "approved");
    const updated = await store.getDashboard();
    expect(updated.engagement.scopeRules).toContainEqual(expect.objectContaining({ kind: "host", value: "files.northstar.test", action: "allow" }));
    expect(executor.dispatched).toHaveLength(before);
  });

  it("terminates an active specialist through the execution driver", async () => {
    const result = await service.terminate("ar_browser");
    expect(result.status).toBe("terminated");
    expect(executor.terminated).toEqual(["ar_browser"]);
  });

  it("pauses containers that are waiting on a human scope decision", async () => {
    await service.ingest("ar_explorer", { type: "scope_proposal", kind: "host", value: "files.northstar.test", rationale: "A rendered workflow links to the file service." });
    await service.setRunState("run_demo", "paused");
    expect(executor.controls.at(-1)).toEqual(expect.objectContaining({ action: "pause", agentRunIds: expect.arrayContaining(["ar_explorer"]) }));
  });

  it("rejects late evidence from completed executions", async () => {
    await expect(service.ingest("ar_ports", { type: "log", level: "info", message: "late output" })).rejects.toThrow(/no longer active/i);
  });
});
