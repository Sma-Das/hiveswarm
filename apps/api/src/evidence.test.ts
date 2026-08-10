import { evidenceAttackPaths, findingEvidencePath, projectSwarm } from "@hiveswarm/contracts";
import { describe, expect, it } from "vitest";
import { createDemoDashboard } from "./seed.js";

describe("evidence projections", () => {
  it("links findings through stored agent-run provenance instead of display names", () => {
    const dashboard = createDemoDashboard();
    const first = dashboard.agents.find((agent) => agent.id === "ar_browser")!;
    const second = dashboard.agents.find((agent) => agent.id === "ar_source")!;
    second.agentName = first.agentName;
    dashboard.findings[0]!.agentRunId = second.id;
    dashboard.findings[0]!.discoveredBy = first.agentName;

    const swarm = projectSwarm([first, second], [dashboard.findings[0]!]);

    expect(swarm.edges).toContainEqual(expect.objectContaining({ source: second.id, target: `swarm-${dashboard.findings[0]!.id}` }));
    expect(swarm.edges).not.toContainEqual(expect.objectContaining({ source: first.id, target: `swarm-${dashboard.findings[0]!.id}` }));
  });

  it("derives bounded finding and report paths from the same graph", () => {
    const dashboard = createDemoDashboard();
    const finding = dashboard.findings[0]!;
    const path = findingEvidencePath(dashboard, finding);
    const reportPaths = evidenceAttackPaths(dashboard);

    expect(path.nodes.some((node) => node.metadata.findingId === finding.id)).toBe(true);
    expect(reportPaths.some((candidate) => candidate.labels.includes("Stale invitation token"))).toBe(true);
    expect(reportPaths.length).toBeLessThanOrEqual(20);
  });

  it("leaves legacy findings without provenance unowned instead of guessing", () => {
    const dashboard = createDemoDashboard();
    const { agentRunId: _agentRunId, ...finding } = dashboard.findings[0]!;
    const swarm = projectSwarm(dashboard.agents, [finding]);
    expect(swarm.nodes).toContainEqual(expect.objectContaining({ id: `swarm-${finding.id}` }));
    expect(swarm.edges.some((edge) => edge.target === `swarm-${finding.id}`)).toBe(false);
  });
});
