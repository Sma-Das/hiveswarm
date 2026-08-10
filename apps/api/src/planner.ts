import type { AgentManifest, Dashboard } from "@hiveswarm/contracts";

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
