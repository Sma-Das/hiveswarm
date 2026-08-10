import { describe, expect, it } from "vitest";
import { agentManifestSchema, spawnAgentRequestSchema } from "@hiveswarm/contracts";
import { PolicyEngine } from "./policy.js";
import { createDemoDashboard } from "./seed.js";

const manifest = agentManifestSchema.parse({
  schemaVersion: "1", id: "test-agent", name: "Test agent", version: "1.0.0",
  description: "A bounded test agent for policy verification.", role: "test", image: "test:latest", command: ["test"],
  lifecycle: ["task"], capabilities: ["network.active", "network.high-rate", "shell.execute"], skills: [], accepts: [], emits: [], configuration: [], enabled: true, labels: {},
});

describe("PolicyEngine", () => {
  const policy = new PolicyEngine();
  it("allows an in-scope bounded task", () => {
    const request = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Inspect the approved host safely", target: "app.northstar.test", requestedCapabilities: ["network.active"] });
    expect(policy.evaluate(createDemoDashboard(), manifest, request)).toEqual({ allowed: true, depth: 1 });
  });
  it("requires approval for a denied host", () => {
    const request = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Inspect the administrative host", target: "admin.northstar.test", requestedCapabilities: [] });
    expect(policy.evaluate(createDemoDashboard(), manifest, request)).toMatchObject({ allowed: false, approvalType: "scope_expansion" });
  });
  it("requires approval for high-rate scanning", () => {
    const request = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Scan the approved host quickly", target: "app.northstar.test", requestedCapabilities: ["network.high-rate"] });
    expect(policy.evaluate(createDemoDashboard(), manifest, request)).toMatchObject({ allowed: false, approvalType: "high_rate_scan" });
  });
  it("rejects recursion beyond depth five", () => {
    const dashboard = createDemoDashboard();
    dashboard.agents.push({ id: "parent", runId: "run_demo", parentAgentRunId: null, agentId: "test-agent", agentName: "Parent", lifecycle: "task", status: "running", depth: 5, task: "Parent task", target: "app.northstar.test", requestedCapabilities: [], executionPlan: [], startedAt: null, completedAt: null, logCount: 0 });
    const request = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Attempt another recursive task", target: "app.northstar.test", parentAgentRunId: "parent", requestedCapabilities: [] });
    expect(policy.evaluate(dashboard, manifest, request)).toMatchObject({ allowed: false, reason: "Recursive agent depth cannot exceed five." });
  });
  it("matches IPv4 and IPv6 CIDR boundaries", () => {
    const dashboard = createDemoDashboard();
    dashboard.engagement.scopeRules = [
      { id: "v4", kind: "cidr", value: "10.20.0.0/16", action: "allow" },
      { id: "v6", kind: "cidr", value: "2001:db8::/32", action: "allow" },
    ];
    const request4 = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Inspect the approved IPv4 host", target: "10.20.4.9", requestedCapabilities: [] });
    const request6 = spawnAgentRequestSchema.parse({ agentId: "test-agent", lifecycle: "task", task: "Inspect the approved IPv6 host", target: "http://[2001:db8::25]", requestedCapabilities: [] });
    expect(policy.evaluate(dashboard, manifest, request4)).toMatchObject({ allowed: true });
    expect(policy.evaluate(dashboard, manifest, request6)).toMatchObject({ allowed: true });
  });
  it("requires a human to review an exact freeform shell plan", () => {
    const request = spawnAgentRequestSchema.parse({
      agentId: "test-agent", lifecycle: "task", task: "Collect bounded diagnostic evidence", target: "app.northstar.test",
      requestedCapabilities: ["shell.execute"], executionPlan: [{ label: "Resolve target", command: "getent hosts app.northstar.test", timeoutSeconds: 30 }],
    });
    expect(policy.evaluate(createDemoDashboard(), manifest, request)).toMatchObject({ allowed: false, approvalType: "high_risk_capability" });
  });
  it("rejects opaque shell access without a reviewable command plan", () => {
    const request = spawnAgentRequestSchema.parse({
      agentId: "test-agent", lifecycle: "task", task: "Collect bounded diagnostic evidence", target: "app.northstar.test", requestedCapabilities: ["shell.execute"],
    });
    expect(policy.evaluate(createDemoDashboard(), manifest, request)).toMatchObject({ allowed: false, reason: "Shell execution requires a non-empty, reviewable command plan." });
  });
});
