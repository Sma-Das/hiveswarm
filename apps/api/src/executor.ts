import type { AgentRun } from "@hiveswarm/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { id } from "./id.js";
import type { EventBus } from "./events.js";
import type { StateStore } from "./store.js";

export interface ExecutionDriver {
  dispatch(agentRun: AgentRun): Promise<void>;
  terminate(agentRun: AgentRun): Promise<void>;
  controlRun(runId: string, action: "pause" | "resume", agentRunIds: string[]): Promise<void>;
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

  async terminate() {}
  async controlRun() {}
}

export class QueueExecutionDriver implements ExecutionDriver {
  private readonly connection: IORedis;
  private readonly queue: Queue;
  private readonly controlQueue: Queue;

  constructor(redisUrl: string) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue("hiveswarm-agent-executions", { connection: this.connection });
    this.controlQueue = new Queue("hiveswarm-agent-control", { connection: this.connection });
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

  async terminate(agentRun: AgentRun): Promise<void> {
    const queued = await this.queue.getJob(agentRun.id);
    if (queued) {
      const state = await queued.getState();
      if (state === "waiting" || state === "delayed") await queued.remove();
    }
    await this.controlQueue.add("terminate-agent", { runId: agentRun.runId, agentRunIds: [agentRun.id], action: "terminate" }, { removeOnComplete: 500 });
  }

  async controlRun(runId: string, action: "pause" | "resume", agentRunIds: string[]): Promise<void> {
    await this.controlQueue.add(`${action}-run`, { runId, agentRunIds, action }, { removeOnComplete: 500 });
  }

  async close() {
    await this.controlQueue.close();
    await this.queue.close();
    await this.connection.quit();
  }
}
