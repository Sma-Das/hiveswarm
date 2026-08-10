import {
  spawnAgentRequestSchema,
  type OrchestrateRequest,
} from "@hiveswarm/contracts";
import type { ModelProvider } from "./model-provider.js";
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
    const spawned: OrchestrationOutcome["spawned"] = [];
    const result = await this.modelProvider!.orchestrate({
      ...(options.objective ? { objective: options.objective } : {}),
      maxTurns: options.maxTurns,
      maxAgents: options.maxAgents,
      dashboard,
      agents,
    }, async (proposal) => {
      try {
        if (!installedIds.has(proposal.agentId) || proposal.agentId === "orchestrator") throw new Error("The selected specialist is not installed and enabled.");
        const spawnResult = await this.orchestrator.spawn(spawnAgentRequestSchema.parse({
          ...proposal,
          ...(proposal.parentAgentRunId ? { parentAgentRunId: proposal.parentAgentRunId } : root ? { parentAgentRunId: root.id } : {}),
        }), runId);
        spawned.push({ agentRunId: spawnResult.agentRun.id, agentId: spawnResult.agentRun.agentId, approvalRequired: spawnResult.approvalRequired });
        return { ok: true, agentRunId: spawnResult.agentRun.id, status: spawnResult.agentRun.status, approvalRequired: spawnResult.approvalRequired };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Specialist proposal failed." };
      }
    });
    return { provider: this.modelProvider!.id, ...result, spawned };
  }
}
