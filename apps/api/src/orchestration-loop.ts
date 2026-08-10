import {
  agentCapabilitySchema,
  executionStepSchema,
  spawnAgentRequestSchema,
  type AgentManifest,
  type OrchestrateRequest,
} from "@hiveswarm/contracts";
import { z } from "zod";
import { responseText, type ModelProvider, type ModelResponseItem } from "./model-provider.js";
import type { OrchestratorService } from "./orchestrator.js";
import type { Planner } from "./planner.js";
import type { AgentRegistry } from "./registry.js";
import type { StateStore } from "./store.js";

export type OrchestrationOutcome = {
  provider: string;
  summary: string;
  turns: number;
  spawned: Array<{ agentRunId: string; agentId: string; approvalRequired: boolean }>;
  stoppedReason: "completed" | "no_tool_calls" | "turn_limit" | "agent_limit";
};

const spawnToolInput = z.object({
  agentId: z.string(),
  lifecycle: z.enum(["task", "session"]),
  task: z.string().min(8).max(4000),
  target: z.string().min(1).max(2048),
  parentAgentRunId: z.string().nullable(),
  requestedCapabilities: z.array(agentCapabilitySchema),
  executionPlan: z.array(executionStepSchema).max(12),
});

const finishToolInput = z.object({ summary: z.string().min(1).max(4000) });

function agentCatalog(agents: AgentManifest[]) {
  return agents
    .filter((agent) => agent.id !== "orchestrator")
    .map(({ id, name, role, description, lifecycle, capabilities, accepts, emits, skills }) => ({
      id, name, role, description, lifecycle, capabilities, accepts, emits, skills,
    }));
}

function tools(agents: AgentManifest[]) {
  return [
    {
      type: "function",
      name: "spawn_specialist",
      description: "Start one installed specialist. The policy engine re-validates scope, lifecycle, recursion depth, requested capabilities, and any freeform command plan. Returns the agent run ID or a structured policy error.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["agentId", "lifecycle", "task", "target", "parentAgentRunId", "requestedCapabilities", "executionPlan"],
        properties: {
          agentId: { type: "string", enum: agents.filter((agent) => agent.id !== "orchestrator").map((agent) => agent.id) },
          lifecycle: { type: "string", enum: ["task", "session"] },
          task: { type: "string", description: "A bounded, evidence-oriented assignment with an explicit stopping condition." },
          target: { type: "string", description: "The exact host, URL, or repository to evaluate. It must match an active allow rule." },
          parentAgentRunId: { type: ["string", "null"], description: "The parent execution ID. Use the root orchestrator run ID for direct children." },
          requestedCapabilities: { type: "array", items: { type: "string", enum: agentCapabilitySchema.options } },
          executionPlan: {
            type: "array",
            maxItems: 12,
            description: "For freeform-ubuntu only: an exact, bounded command list that a human can review. Use an empty array for all other specialists.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "command", "timeoutSeconds"],
              properties: {
                label: { type: "string" },
                command: { type: "string" },
                timeoutSeconds: { type: "integer", minimum: 1, maximum: 300 },
              },
            },
          },
        },
      },
    },
    {
      type: "function",
      name: "finish_evaluation",
      description: "Stop orchestration when the initial specialist coverage is sufficient or further work requires human input. Returns success.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: { summary: { type: "string" } },
      },
    },
  ];
}

export class OrchestrationLoop {
  constructor(
    private readonly store: StateStore,
    private readonly registry: AgentRegistry,
    private readonly orchestrator: OrchestratorService,
    private readonly fallbackPlanner: Planner,
    private readonly modelProvider?: ModelProvider,
  ) {}

  async run(options: OrchestrateRequest, runId: string): Promise<OrchestrationOutcome> {
    return this.modelProvider ? this.runWithModel(options, runId) : this.runDeterministic(options, runId);
  }

  private async runDeterministic(options: OrchestrateRequest, runId: string): Promise<OrchestrationOutcome> {
    const dashboard = await this.store.getDashboardForRun(runId);
    const agents = await this.registry.list();
    const plan = await this.fallbackPlanner.createPlan(dashboard, agents);
    const spawned: OrchestrationOutcome["spawned"] = [];
    const parentAgentRunId = dashboard.agents.find((agent) => agent.depth === 0)?.id;
    for (const step of plan.steps.slice(0, options.maxAgents)) {
      const manifest = agents.find((agent) => agent.id === step.agentId);
      const result = await this.orchestrator.spawn(spawnAgentRequestSchema.parse({
        agentId: step.agentId,
        lifecycle: step.lifecycle,
        task: step.task,
        target: dashboard.engagement.target,
        ...(parentAgentRunId ? { parentAgentRunId } : {}),
        requestedCapabilities: manifest?.capabilities.filter((capability) => !["network.high-rate", "credentials.use", "exploit.execute", "shell.execute"].includes(capability)) ?? [],
        executionPlan: [],
      }), runId);
      spawned.push({ agentRunId: result.agentRun.id, agentId: result.agentRun.agentId, approvalRequired: result.approvalRequired });
    }
    return { provider: "deterministic", summary: plan.summary, turns: 1, spawned, stoppedReason: plan.steps.length > options.maxAgents ? "agent_limit" : "completed" };
  }

  private async runWithModel(options: OrchestrateRequest, runId: string): Promise<OrchestrationOutcome> {
    const dashboard = await this.store.getDashboardForRun(runId);
    const agents = (await this.registry.list()).filter((agent) => agent.enabled);
    const installedIds = new Set(agents.map((agent) => agent.id));
    const root = dashboard.agents.find((agent) => agent.depth === 0);
    const availableTools = tools(agents);
    const spawned: OrchestrationOutcome["spawned"] = [];
    let summary = "Initial specialist orchestration completed.";
    let input: Array<Record<string, unknown> | ModelResponseItem> = [
      {
        role: "developer",
        content: [
          "You are HiveSwarm's manager-controlled orchestrator for an authorized application-security evaluation.",
          "Select specialists only from the supplied live registry. Prefer passive discovery before active scanning.",
          "Never widen scope yourself. Out-of-scope actions must be allowed to become human approval requests.",
          "Use the least capabilities necessary. Do not request credentials, high-rate scanning, or exploit execution unless the objective explicitly requires it.",
          "Use freeform-ubuntu only when no purpose-built specialist fits. Give it an exact goal and bounded executionPlan, request shell.execute, and let the human approval gate review every command.",
          `Create no more than ${options.maxAgents} specialists. Call finish_evaluation when the initial coverage is sufficient.`,
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          objective: options.objective ?? "Map the authorized attack surface, inspect core application workflows, identify plausible vulnerabilities, and maintain evidence for reporting.",
          engagement: dashboard.engagement,
          rootAgentRunId: root?.id ?? null,
          currentAgents: dashboard.agents,
          installedSpecialists: agentCatalog(agents),
        }),
      },
    ];

    for (let turn = 1; turn <= options.maxTurns; turn += 1) {
      const payload = await this.modelProvider!.createResponse({
          safety_identifier: `engagement_${dashboard.engagement.id}`,
          reasoning: { effort: "medium" },
          input,
          tools: availableTools,
          tool_choice: "auto",
          parallel_tool_calls: false,
          store: false,
      });
      input.push(...payload.output);
      const calls = payload.output.filter((item) => item.type === "function_call");
      if (!calls.length) {
        return { provider: this.modelProvider!.id, summary: responseText(payload) || summary, turns: turn, spawned, stoppedReason: "no_tool_calls" };
      }

      for (const call of calls) {
        if (!call.call_id || !call.name || typeof call.arguments !== "string") continue;
        let output: Record<string, unknown>;
        try {
          if (call.name === "finish_evaluation") {
            const parsed = finishToolInput.parse(JSON.parse(call.arguments));
            summary = parsed.summary;
            output = { ok: true, summary };
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
            return { provider: this.modelProvider!.id, summary, turns: turn, spawned, stoppedReason: "completed" };
          }
          if (call.name !== "spawn_specialist") throw new Error(`Unsupported orchestration tool ${call.name}.`);
          if (spawned.length >= options.maxAgents) {
            output = { ok: false, error: "agent_limit_reached", maxAgents: options.maxAgents };
          } else {
            const parsed = spawnToolInput.parse(JSON.parse(call.arguments));
            if (!installedIds.has(parsed.agentId) || parsed.agentId === "orchestrator") throw new Error("The selected specialist is not installed and enabled.");
            const result = await this.orchestrator.spawn(spawnAgentRequestSchema.parse({
              ...parsed,
              ...(parsed.parentAgentRunId ? { parentAgentRunId: parsed.parentAgentRunId } : root ? { parentAgentRunId: root.id } : {}),
            }), runId);
            spawned.push({ agentRunId: result.agentRun.id, agentId: result.agentRun.agentId, approvalRequired: result.approvalRequired });
            output = { ok: true, agentRunId: result.agentRun.id, status: result.agentRun.status, approvalRequired: result.approvalRequired };
          }
        } catch (error) {
          output = { ok: false, error: error instanceof Error ? error.message : "Tool execution failed." };
        }
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      if (spawned.length >= options.maxAgents) {
        return { provider: this.modelProvider!.id, summary: `Started ${spawned.length} bounded specialists.`, turns: turn, spawned, stoppedReason: "agent_limit" };
      }
    }
    return { provider: this.modelProvider!.id, summary, turns: options.maxTurns, spawned, stoppedReason: "turn_limit" };
  }
}
