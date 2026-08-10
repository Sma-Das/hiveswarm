import type { AgentManifest, Dashboard } from "@hiveswarm/contracts";
import { responseText, type ModelProvider } from "./model-provider.js";

export type PlanStep = { agentId: string; lifecycle: "task" | "session"; task: string; rationale: string };
export type EvaluationPlan = { summary: string; steps: PlanStep[] };

export interface Planner {
  createPlan(dashboard: Dashboard, agents: AgentManifest[]): Promise<EvaluationPlan>;
}

export class DeterministicPlanner implements Planner {
  async createPlan(_dashboard: Dashboard, agents: AgentManifest[]): Promise<EvaluationPlan> {
    const preferred = ["explorer", "browser-user", "source-review", "reporter"];
    return {
      summary: "Begin with passive surface mapping, observe core browser workflows, review matching source paths, then normalize evidence continuously.",
      steps: preferred.flatMap((agentId): PlanStep[] => {
        const agent = agents.find((item) => item.id === agentId);
        if (!agent) return [];
        return [{
          agentId,
          lifecycle: agent.lifecycle.includes("session") && ["explorer", "browser-user", "reporter"].includes(agentId) ? "session" : "task",
          task: agent.description,
          rationale: `The ${agent.role} role provides ${agent.emits.join(", ") || "specialist evidence"}.`,
        }];
      }),
    };
  }
}

export class OpenAiPlanner implements Planner {
  constructor(private readonly provider: ModelProvider) {}

  async createPlan(dashboard: Dashboard, agents: AgentManifest[]): Promise<EvaluationPlan> {
    const response = await this.provider.createResponse({
        safety_identifier: `engagement_${dashboard.engagement.id}`,
        reasoning: { effort: "medium" },
        input: [
          {
            role: "developer",
            content: "You are the planning layer for an authorized application-security evaluation. Select only registered agents. Keep the manager in control. Do not expand scope or request high-risk capabilities. Return the requested JSON only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              target: dashboard.engagement.target,
              scope: dashboard.engagement.scopeRules,
              agents: agents.map(({ id, role, description, lifecycle, capabilities, accepts, emits }) => ({ id, role, description, lifecycle, capabilities, accepts, emits })),
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
    });
    const output = responseText(response);
    if (!output) throw new Error(`${this.provider.id} planning returned no structured output.`);
    return JSON.parse(output) as EvaluationPlan;
  }
}
