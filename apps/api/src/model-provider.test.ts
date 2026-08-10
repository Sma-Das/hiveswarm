import { agentManifestSchema } from "@hiveswarm/contracts";
import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesProvider } from "./model-provider.js";
import { createDemoDashboard } from "./seed.js";

const manifest = agentManifestSchema.parse({
  schemaVersion: "1",
  id: "test-agent",
  name: "Test agent",
  version: "1.0.0",
  description: "A bounded specialist used to verify provider translation.",
  role: "test",
  image: "test:latest",
  command: ["test"],
  lifecycle: ["task"],
  capabilities: ["network.passive"],
  skills: [], accepts: [], emits: [], configuration: [], enabled: true, labels: {},
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("OpenAiResponsesProvider", () => {
  it("translates structured planning output into a validated evaluation plan", async () => {
    const fetchAdapter = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({
      id: "response-plan",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "Start passively.", steps: [{ agentId: "test-agent", lifecycle: "task", task: "Inspect the authorized target", rationale: "Collect bounded evidence." }] }) }] }],
    }));
    const provider = new OpenAiResponsesProvider("test-key", "test-model", fetchAdapter);

    const plan = await provider.createPlan(createDemoDashboard(), [manifest]);

    expect(plan.steps).toEqual([expect.objectContaining({ agentId: "test-agent", lifecycle: "task" })]);
    const request = JSON.parse(fetchAdapter.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(request).toEqual(expect.objectContaining({ model: "test-model", text: expect.any(Object) }));
  });

  it("owns multi-turn tool translation while exposing only domain spawn proposals", async () => {
    const responses = [
      {
        id: "response-spawn",
        output: [{
          type: "function_call",
          name: "spawn_specialist",
          call_id: "call-spawn",
          arguments: JSON.stringify({ agentId: "test-agent", lifecycle: "task", task: "Inspect the authorized target", target: "app.northstar.test", parentAgentRunId: null, requestedCapabilities: ["network.passive"], executionPlan: [] }),
        }],
      },
      {
        id: "response-finish",
        output: [{ type: "function_call", name: "finish_evaluation", call_id: "call-finish", arguments: JSON.stringify({ summary: "Initial coverage is sufficient." }) }],
      },
    ];
    const fetchAdapter = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(responses.shift()));
    const provider = new OpenAiResponsesProvider("test-key", "test-model", fetchAdapter);
    const spawn = vi.fn(async () => ({ ok: true as const, agentRunId: "ar_new", status: "queued", approvalRequired: false }));

    const result = await provider.orchestrate({ dashboard: createDemoDashboard(), agents: [manifest], maxTurns: 3, maxAgents: 2 }, spawn);

    expect(spawn).toHaveBeenCalledWith({
      agentId: "test-agent",
      lifecycle: "task",
      task: "Inspect the authorized target",
      target: "app.northstar.test",
      requestedCapabilities: ["network.passive"],
      executionPlan: [],
    });
    expect(result).toEqual({ summary: "Initial coverage is sufficient.", turns: 2, stoppedReason: "completed" });
    const secondRequest = JSON.parse(fetchAdapter.mock.calls[1]![1]!.body as string) as { input: Array<{ type?: string; call_id?: string }> };
    expect(secondRequest.input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call-spawn" }));
  });

  it("rejects malformed provider output at the adapter seam", async () => {
    const fetchAdapter = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({
      id: "response-plan",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "Missing steps" }) }] }],
    }));
    const provider = new OpenAiResponsesProvider("test-key", "test-model", fetchAdapter);
    await expect(provider.createPlan(createDemoDashboard(), [manifest])).rejects.toThrow();
  });
});
