import { describe, expect, it } from "vitest";
import { EventBus } from "./events.js";
import { SimulatedExecutionDriver } from "./executor.js";
import { createDemoDashboard } from "./seed.js";
import { MemoryStore } from "./store.js";

describe("MemoryStore projects", () => {
  it("keeps project graphs independent and resolves background callbacks by run", async () => {
    const store = new MemoryStore();
    const second = createDemoDashboard();
    second.engagement = { ...second.engagement, id: "eng_second", name: "Second project", target: "api.second.test" };
    second.agents = second.agents.map((agent) => ({ ...agent, id: `${agent.id}_second`, runId: "run_second", parentAgentRunId: agent.parentAgentRunId ? `${agent.parentAgentRunId}_second` : null }));
    await store.saveDashboard(second);
    await store.setActiveProject("eng_second");

    expect((await store.listProjects()).map((project) => project.id)).toEqual(expect.arrayContaining(["eng_demo", "eng_second"]));
    expect((await store.getDashboard()).engagement.id).toBe("eng_second");
    expect((await store.getDashboard("eng_demo")).engagement.name).toBe("Northstar portal");
    expect((await store.getDashboardForRun("run_demo")).engagement.id).toBe("eng_demo");
    expect((await store.getDashboardForAgent("ar_browser_second")).engagement.id).toBe("eng_second");
  });

  it("rejects unknown project switches", async () => {
    const store = new MemoryStore();
    await expect(store.setActiveProject("missing")).rejects.toThrow(/project not found/i);
  });

  it("mutates the stored agent owner even when another project is active", async () => {
    const store = new MemoryStore();
    const first = await store.getDashboard("eng_demo");
    const ownedAgent = first.agents.find((agent) => agent.id === "ar_browser")!;
    ownedAgent.status = "queued";
    await store.saveDashboard(first);

    const second = createDemoDashboard();
    second.engagement = { ...second.engagement, id: "eng_second", name: "Second project", target: "api.second.test" };
    second.agents = second.agents.map((agent) => ({ ...agent, id: `${agent.id}_second`, runId: "run_second", parentAgentRunId: agent.parentAgentRunId ? `${agent.parentAgentRunId}_second` : null }));
    await store.saveDashboard(second);
    await store.setActiveProject("eng_second");

    await new SimulatedExecutionDriver(store, new EventBus()).dispatch(ownedAgent);

    const updatedFirst = await store.getDashboard("eng_demo");
    const unchangedSecond = await store.getDashboard("eng_second");
    expect(updatedFirst.agents.find((agent) => agent.id === "ar_browser")?.status).toBe("running");
    expect(updatedFirst.logs[0]?.message).toMatch(/Sandbox prepared/);
    expect(unchangedSecond.logs.some((log) => /Sandbox prepared/.test(log.message))).toBe(false);
  });

  it("serializes project mutations without losing either result", async () => {
    const store = new MemoryStore();
    await Promise.all([
      store.mutateDashboard({ kind: "project", id: "eng_demo" }, (dashboard) => { dashboard.engagement.name = "Renamed"; }),
      store.mutateDashboard({ kind: "run", id: "run_demo" }, (dashboard) => { dashboard.engagement.target = "renamed.northstar.test"; }),
    ]);
    const dashboard = await store.getDashboard("eng_demo");
    expect(dashboard.engagement.name).toBe("Renamed");
    expect(dashboard.engagement.target).toBe("renamed.northstar.test");
  });
});
