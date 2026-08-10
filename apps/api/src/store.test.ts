import { describe, expect, it } from "vitest";
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
});
