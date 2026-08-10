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

const freeformManifest = agentManifestSchema.parse({
  schemaVersion: "1", id: "freeform-ubuntu", name: "Freeform Ubuntu", version: "0.1.0",
  description: "A governed Ubuntu generalist used to verify reviewed command execution.", role: "bounded-generalist", image: "test:latest", command: ["test"],
  lifecycle: ["task"], capabilities: ["shell.execute", "network.passive", "graph.write", "finding.write"], skills: [], accepts: [], emits: [], configuration: [], enabled: true, labels: {},
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
    const registry = { get: async (agentId: string) => [manifest, freeformManifest].find((item) => item.id === agentId), list: async () => [manifest, freeformManifest] } as AgentRegistry;
    service = new OrchestratorService(store, registry, executor, new EventBus());
  });

  it("blocks new execution while the run is paused", async () => {
    const dashboard = await store.getDashboard();
    dashboard.engagement.status = "paused";
    await store.saveDashboard(dashboard);
    await expect(service.spawn({ agentId: manifest.id, lifecycle: "task", task: "Inspect the approved host safely", target: "app.northstar.test", requestedCapabilities: [], executionPlan: [] }, "run_demo")).rejects.toThrow(/paused/i);
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

  it("stores the exact freeform plan and presents every command for human approval", async () => {
    const result = await service.spawn({
      agentId: "freeform-ubuntu", lifecycle: "task", task: "Collect a bounded host diagnostic", target: "app.northstar.test",
      requestedCapabilities: ["shell.execute", "network.passive"],
      executionPlan: [
        { label: "Resolve host", command: "getent hosts app.northstar.test", timeoutSeconds: 30 },
        { label: "Read robots", command: "curl -fsS --max-time 15 https://app.northstar.test/robots.txt", timeoutSeconds: 30 },
      ],
    }, "run_demo");
    expect(result.approvalRequired).toBe(true);
    expect(executor.dispatched).not.toContain(result.agentRun.id);
    const dashboard = await store.getDashboard();
    const approval = dashboard.approvals.find((item) => item.agentRunId === result.agentRun.id);
    expect(approval?.requestedAction).toContain("getent hosts app.northstar.test");
    expect(approval?.requestedAction).toContain("curl -fsS --max-time 15");
    expect(result.agentRun.executionPlan).toHaveLength(2);
  });

  it("rejects structured evidence that was not granted to the execution", async () => {
    await expect(service.ingest("ar_explorer", {
      type: "finding",
      finding: { title: "Unapproved finding", severity: "low", status: "open", confidence: 0.5, assetLabel: "test", summary: "This event should be rejected.", evidence: [], discoveredBy: "Explorer" },
    })).rejects.toThrow(/finding\.write/i);
  });
});
