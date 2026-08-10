import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentManifest, AgentRun } from "@hiveswarm/contracts";
import { agentManifestSchema } from "@hiveswarm/contracts";
import { Worker } from "bullmq";
import Docker from "dockerode";
import IORedis from "ioredis";
import { fileURLToPath } from "node:url";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const apiUrl = process.env.API_URL ?? "http://localhost:4100";
const registryPath = process.env.AGENT_REGISTRY_PATH ?? fileURLToPath(new URL("../../../agents", import.meta.url));
const callbackToken = process.env.AGENT_CALLBACK_TOKEN ?? "";
const mode = process.env.WORKER_MODE === "docker" ? "docker" : "simulated";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

async function manifestFor(agentId: string): Promise<AgentManifest> {
  const raw = await readFile(join(registryPath, agentId, "agent.json"), "utf8");
  return agentManifestSchema.parse(JSON.parse(raw));
}

async function callback(agentRunId: string, path: "events" | "complete", body: unknown) {
  const response = await fetch(`${apiUrl}/api/agent-runs/${agentRunId}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(callbackToken ? { Authorization: `Bearer ${callbackToken}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Agent callback failed with status ${response.status}.`);
}

async function simulate(agentRun: AgentRun) {
  await callback(agentRun.id, "events", { type: "log", level: "info", message: `Worker claimed ${agentRun.agentName} task in simulated mode.` } satisfies AgentEvent);
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (agentRun.lifecycle === "task") {
    await callback(agentRun.id, "complete", { outcome: "completed", message: "Simulation completed; install the specialist image and select Docker mode for real execution." });
  }
}

async function executeContainer(agentRun: AgentRun, manifest: AgentManifest) {
  const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });
  const needsNetwork = manifest.capabilities.some((capability) => capability.startsWith("network.") || capability === "browser.interactive" || capability === "proxy.intercept");
  const container = await docker.createContainer({
    Image: manifest.image,
    Cmd: manifest.command,
    Env: [
      `HIVESWARM_AGENT_ID=${manifest.id}`,
      `HIVESWARM_AGENT_RUN_ID=${agentRun.id}`,
      `HIVESWARM_TASK=${agentRun.task}`,
      `HIVESWARM_TARGET=${agentRun.target}`,
      `HIVESWARM_LIFECYCLE=${agentRun.lifecycle}`,
      `HIVESWARM_DEPTH=${agentRun.depth}`,
    ],
    Labels: { "hiveswarm.agent": manifest.id, "hiveswarm.agent-run": agentRun.id },
    OpenStdin: agentRun.lifecycle === "session",
    Tty: false,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      NetworkMode: needsNetwork ? (process.env.AGENT_NETWORK ?? "hiveswarm-egress") : "none",
      Memory: 512 * 1024 * 1024,
      NanoCpus: 1_000_000_000,
      PidsLimit: 256,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=128m" },
    },
  });

  const stream = await container.attach({ stream: true, stdout: true, stderr: true });
  stream.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
    if (text) void callback(agentRun.id, "events", { type: "log", level: "info", message: text.slice(0, 8_000) } satisfies AgentEvent);
  });
  await container.start();
  const result = await container.wait();
  await callback(agentRun.id, "complete", {
    outcome: result.StatusCode === 0 ? "completed" : "failed",
    message: result.StatusCode === 0 ? `${manifest.name} completed.` : `${manifest.name} exited with status ${result.StatusCode}.`,
  });
  await container.remove({ force: true });
}

const worker = new Worker<AgentRun>(
  "hiveswarm-agent-executions",
  async (job) => {
    const manifest = await manifestFor(job.data.agentId);
    if (mode === "simulated") return simulate(job.data);
    return executeContainer(job.data, manifest);
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3), lockDuration: 120_000 },
);

worker.on("completed", (job) => console.info(`Completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`Failed ${job?.id ?? "unknown"}: ${error.message}`));

async function shutdown() {
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
console.info(`HiveSwarm worker ready (${mode} mode).`);
