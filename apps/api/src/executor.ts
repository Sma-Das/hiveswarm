import type { AgentRun } from "@hiveswarm/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { id } from "./id.js";
import type { EventBus } from "./events.js";
import type { StateStore } from "./store.js";

export interface ExecutionDriver {
  dispatch(agentRun: AgentRun): Promise<void>;
  close?(): Promise<void>;
}

export class SimulatedExecutionDriver implements ExecutionDriver {
  constructor(private readonly store: StateStore, private readonly events: EventBus) {}

  async dispatch(agentRun: AgentRun) {
    const dashboard = await this.store.getDashboard();
    const current = dashboard.agents.find((agent) => agent.id === agentRun.id);
    if (!current) return;
    current.status = "running";
    current.startedAt = new Date().toISOString();
    dashboard.logs.unshift({
      id: id("log"), agentRunId: current.id, level: "info",
      message: `Sandbox prepared for ${current.agentName}; waiting for specialist output.`, timestamp: new Date().toISOString(),
    });
    current.logCount += 1;
    dashboard.metrics.activeAgents = dashboard.agents.filter((agent) => agent.status === "running").length;
    await this.store.saveDashboard(dashboard);
    this.events.publish({ id: id("evt"), type: "agent.started", runId: current.runId, occurredAt: new Date().toISOString(), data: { agentRunId: current.id } });
  }
}

export class QueueExecutionDriver implements ExecutionDriver {
  private readonly connection: IORedis;
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("hiveswarm-agent-executions", { connection: this.connection });
  }

  async dispatch(agentRun: AgentRun): Promise<void> {
    await this.queue.add("execute-agent", agentRun, {
      jobId: agentRun.id,
      attempts: 2,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    });
  }

  async close() {
    await this.queue.close();
    await this.connection.quit();
  }
}
