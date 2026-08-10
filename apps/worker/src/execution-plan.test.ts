import { agentManifestSchema, agentRunSchema } from "@hiveswarm/contracts";
import { describe, expect, it } from "vitest";
import { compileExecutionPlan } from "./execution-plan.js";

function manifest(input: Partial<ReturnType<typeof agentManifestSchema.parse>> = {}) {
  return agentManifestSchema.parse({
    schemaVersion: "1", id: "test-agent", name: "Test agent", version: "1.0.0",
    description: "A bounded specialist used to verify worker execution plans.", role: "test", image: "test:latest", command: ["test"],
    lifecycle: ["task"], capabilities: ["network.passive", "source.read", "shell.execute"],
    skills: [], accepts: [], emits: [], configuration: [], enabled: true, labels: {}, ...input,
  });
}

function agentRun(input: Partial<ReturnType<typeof agentRunSchema.parse>> = {}) {
  return agentRunSchema.parse({
    id: "ar_test", runId: "run_test", parentAgentRunId: null, agentId: "test-agent", agentName: "Test agent",
    lifecycle: "task", status: "queued", depth: 1, task: "Inspect the authorized target", target: "app.example.test",
    requestedCapabilities: [], executionPlan: [], startedAt: null, completedAt: null, logCount: 0, ...input,
  });
}

describe("compileExecutionPlan", () => {
  it("keeps generic specialists offline with baseline constraints", () => {
    const plan = compileExecutionPlan(agentRun(), manifest(), "http://api:4100", {});
    expect(plan.HostConfig).toEqual(expect.objectContaining({ ReadonlyRootfs: true, CapDrop: ["ALL"], NetworkMode: "none", Memory: 512 * 1024 * 1024, PidsLimit: 256 }));
    expect(plan.HostConfig?.Mounts).toEqual([expect.objectContaining({ Target: "/artifacts" })]);
  });

  it("compiles an approved source mount beneath the operator root", () => {
    const run = agentRun({ target: "repository:team/project", requestedCapabilities: ["source.read"] });
    const plan = compileExecutionPlan(run, manifest(), "http://api:4100", { HIVESWARM_SOURCE_ROOT: "/srv/source" });
    expect(plan.HostConfig?.Mounts).toContainEqual({ Type: "bind", Source: "/srv/source/team/project", Target: "/target", ReadOnly: true });
    expect(plan.Env).toContain("HIVESWARM_SOURCE_PATH=/target");
  });

  it("rejects source targets that resolve to or outside the operator root", () => {
    const outside = agentRun({ target: "repository:../secret", requestedCapabilities: ["source.read"] });
    const root = agentRun({ target: "repository:.", requestedCapabilities: ["source.read"] });
    expect(() => compileExecutionPlan(outside, manifest(), "http://api:4100", { HIVESWARM_SOURCE_ROOT: "/srv/source" })).toThrow(/escapes/i);
    expect(() => compileExecutionPlan(root, manifest(), "http://api:4100", { HIVESWARM_SOURCE_ROOT: "/srv/source" })).toThrow(/escapes/i);
  });

  it("applies only reviewed freeform and Burp package profiles", () => {
    const freeformRun = agentRun({ agentId: "freeform-ubuntu", requestedCapabilities: ["shell.execute"], executionPlan: [{ label: "Inspect", command: "id", timeoutSeconds: 30 }] });
    const freeform = compileExecutionPlan(freeformRun, manifest({ id: "freeform-ubuntu" }), "http://api:4100", {});
    expect(freeform.Env).toContainEqual(expect.stringMatching(/^HIVESWARM_EXECUTION_PLAN_B64=/));
    expect(freeform.HostConfig?.Tmpfs).toHaveProperty("/workspace");

    const burp = compileExecutionPlan(agentRun({ agentId: "burp-suite" }), manifest({ id: "burp-suite" }), "http://api:4100", { BURP_VOLUME: "reviewed-burp" });
    expect(burp.HostConfig?.Memory).toBe(4_096 * 1024 * 1024);
    expect(burp.HostConfig?.NanoCpus).toBe(2_000_000_000);
    expect(burp.HostConfig?.Mounts).toContainEqual(expect.objectContaining({ Source: "reviewed-burp", Target: "/opt/burp" }));
  });

  it("rejects capabilities not declared by the installed manifest", () => {
    const run = agentRun({ requestedCapabilities: ["network.active"] });
    expect(() => compileExecutionPlan(run, manifest({ capabilities: ["network.passive"] }), "http://api:4100", {})).toThrow(/undeclared capability/i);
  });

  it("passes only manifest-allowlisted worker configuration", () => {
    const configured = manifest({ configuration: [{ key: "SCANNER_TOKEN", required: true, secret: true, description: "Scanner access token" }] });
    const plan = compileExecutionPlan(agentRun(), configured, "http://api:4100", { SCANNER_TOKEN: "approved", UNRELATED_SECRET: "blocked" });
    expect(plan.Env).toContain("SCANNER_TOKEN=approved");
    expect(plan.Env?.some((value) => value.startsWith("UNRELATED_SECRET="))).toBe(false);
  });
});
