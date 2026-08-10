import {
  agentCapabilitySchema,
  executionStepSchema,
  type AgentManifest,
  type Dashboard,
  type SpawnAgentRequest,
} from "@hiveswarm/contracts";
import { z } from "zod";
import type { EvaluationPlan, Planner } from "./planner.js";

type ModelResponseItem = {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

type ModelResponse = { id: string; output: ModelResponseItem[] };

export type ProviderOrchestrationRequest = {
  objective?: string;
  maxTurns: number;
  maxAgents: number;
  dashboard: Dashboard;
  agents: AgentManifest[];
};

export type ProviderSpawnResult =
  | { ok: true; agentRunId: string; status: string; approvalRequired: boolean }
  | { ok: false; error: string };

export type ProviderOrchestrationResult = {
  summary: string;
  turns: number;
  stoppedReason: "completed" | "no_tool_calls" | "turn_limit" | "agent_limit";
};

export interface ModelProvider extends Planner {
  readonly id: string;
  orchestrate(
    request: ProviderOrchestrationRequest,
    spawn: (proposal: SpawnAgentRequest) => Promise<ProviderSpawnResult>,
  ): Promise<ProviderOrchestrationResult>;
}

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
const evaluationPlanSchema = z.object({
  summary: z.string(),
  steps: z.array(z.object({
    agentId: z.string(),
    lifecycle: z.enum(["task", "session"]),
    task: z.string(),
    rationale: z.string(),
  })),
});

function responseText(response: ModelResponse) {
  return response.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function agentCatalog(agents: AgentManifest[]) {
  return agents
    .filter((agent) => agent.id !== "orchestrator")
    .map(({ id, name, role, description, lifecycle, capabilities, accepts, emits, skills }) => ({
      id, name, role, description, lifecycle, capabilities, accepts, emits, skills,
    }));
}

function orchestrationTools(agents: AgentManifest[]) {
  return [
    {
      type: "function",
      name: "spawn_specialist",
      description: "Start one installed specialist. Local policy re-validates scope, lifecycle, recursion depth, requested capabilities, and any freeform command plan.",
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
          parentAgentRunId: { type: ["string", "null"], description: "The parent execution ID, or null for the root orchestrator." },
          requestedCapabilities: { type: "array", items: { type: "string", enum: agentCapabilitySchema.options } },
          executionPlan: {
            type: "array",
            maxItems: 12,
            description: "For freeform-ubuntu only: an exact, bounded command list. Empty for purpose-built specialists.",
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
      description: "Stop orchestration when initial coverage is sufficient or further work requires human input.",
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

type FetchAdapter = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class OpenAiResponsesProvider implements ModelProvider {
  readonly id = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchAdapter: FetchAdapter = fetch,
  ) {}

  async createPlan(dashboard: Dashboard, agents: AgentManifest[]): Promise<EvaluationPlan> {
    const response = await this.createResponse({
      safety_identifier: `engagement_${dashboard.engagement.id}`,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "developer",
          content: "You are the planning module for an authorized application-security evaluation. Select only registered agents. Keep the operator in control. Do not expand scope or request high-risk capabilities. Return the requested JSON only.",
        },
        {
          role: "user",
          content: JSON.stringify({
            target: dashboard.engagement.target,
            scope: dashboard.engagement.scopeRules,
            agents: agentCatalog(agents),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "evaluation_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "steps"],
            properties: {
              summary: { type: "string" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["agentId", "lifecycle", "task", "rationale"],
                  properties: {
                    agentId: { type: "string", enum: agents.map((agent) => agent.id) },
                    lifecycle: { type: "string", enum: ["task", "session"] },
                    task: { type: "string" },
                    rationale: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      store: false,
    });
    const output = responseText(response);
    if (!output) throw new Error(`${this.id} planning returned no structured output.`);
    return evaluationPlanSchema.parse(JSON.parse(output));
  }

  async orchestrate(
    request: ProviderOrchestrationRequest,
    spawn: (proposal: SpawnAgentRequest) => Promise<ProviderSpawnResult>,
  ): Promise<ProviderOrchestrationResult> {
    const root = request.dashboard.agents.find((agent) => agent.depth === 0);
    let summary = "Initial specialist orchestration completed.";
    let spawned = 0;
    const input: Array<Record<string, unknown> | ModelResponseItem> = [
      {
        role: "developer",
        content: [
          "You are HiveSwarm's operator-controlled orchestrator for an authorized application-security evaluation.",
          "Select specialists only from the supplied live registry. Prefer passive discovery before active scanning.",
          "Never widen scope yourself. Out-of-scope actions must become visible human approval requests.",
          "Use the least capabilities necessary. Do not request credentials, high-rate scanning, or exploit execution unless the objective explicitly requires it.",
          "Use freeform-ubuntu only when no purpose-built specialist fits. Supply an exact bounded execution plan for human review.",
          `Create no more than ${request.maxAgents} specialists. Call finish_evaluation when initial coverage is sufficient.`,
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          objective: request.objective ?? "Map the authorized attack surface, inspect core application workflows, identify plausible vulnerabilities, and maintain evidence for reporting.",
          engagement: request.dashboard.engagement,
          rootAgentRunId: root?.id ?? null,
          currentAgents: request.dashboard.agents,
          installedSpecialists: agentCatalog(request.agents),
        }),
      },
    ];

    for (let turn = 1; turn <= request.maxTurns; turn += 1) {
      const response = await this.createResponse({
        safety_identifier: `engagement_${request.dashboard.engagement.id}`,
        reasoning: { effort: "medium" },
        input,
        tools: orchestrationTools(request.agents),
        tool_choice: "auto",
        parallel_tool_calls: false,
        store: false,
      });
      input.push(...response.output);
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) return { summary: responseText(response) || summary, turns: turn, stoppedReason: "no_tool_calls" };

      for (const call of calls) {
        if (!call.call_id || !call.name || typeof call.arguments !== "string") continue;
        let output: ProviderSpawnResult | { ok: true; summary: string };
        try {
          if (call.name === "finish_evaluation") {
            summary = finishToolInput.parse(JSON.parse(call.arguments)).summary;
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ ok: true, summary }) });
            return { summary, turns: turn, stoppedReason: "completed" };
          }
          if (call.name !== "spawn_specialist") throw new Error(`Unsupported orchestration tool ${call.name}.`);
          if (spawned >= request.maxAgents) {
            output = { ok: false, error: "agent_limit_reached" };
          } else {
            const parsed = spawnToolInput.parse(JSON.parse(call.arguments));
            const { parentAgentRunId, ...proposal } = parsed;
            output = await spawn({ ...proposal, ...(parentAgentRunId ? { parentAgentRunId } : {}) });
            if (output.ok) spawned += 1;
          }
        } catch (error) {
          output = { ok: false, error: error instanceof Error ? error.message : "Tool execution failed." };
        }
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
      }
      if (spawned >= request.maxAgents) return { summary: `Started ${spawned} bounded specialists.`, turns: turn, stoppedReason: "agent_limit" };
    }
    return { summary, turns: request.maxTurns, stoppedReason: "turn_limit" };
  }

  private async createResponse(request: Record<string, unknown>): Promise<ModelResponse> {
    const response = await this.fetchAdapter("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, ...request }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OpenAI Responses API failed with status ${response.status}: ${detail}`);
    }
    return await response.json() as ModelResponse;
  }
}
