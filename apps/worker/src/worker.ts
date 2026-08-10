import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { AgentEvent, AgentManifest, AgentRun } from "@hiveswarm/contracts";
import { agentEventSchema, agentManifestSchema } from "@hiveswarm/contracts";
import { Worker } from "bullmq";
import Docker from "dockerode";
import IORedis from "ioredis";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const apiUrl = process.env.API_URL ?? "http://localhost:4100";
const registryPath = process.env.AGENT_REGISTRY_PATH ?? fileURLToPath(new URL("../../../agents", import.meta.url));
const callbackToken = process.env.AGENT_CALLBACK_TOKEN ?? "";
const mode = process.env.WORKER_MODE === "docker" ? "docker" : "simulated";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const controlConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });

async function manifestFor(agentId: string): Promise<AgentManifest> {
  try {
    const response = await fetch(`${apiUrl}/api/agents/${encodeURIComponent(agentId)}`, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) return agentManifestSchema.parse((await response.json() as { manifest: unknown }).manifest);
  } catch {}
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
  const needsNetwork = manifest.capabilities.some((capability) => capability.startsWith("network.") || capability === "browser.interactive" || capability === "proxy.intercept");
  const mounts: Docker.MountSettings[] = [
    { Type: "volume", Source: process.env.ARTIFACT_VOLUME ?? "hiveswarm-artifacts", Target: "/artifacts", ReadOnly: false },
  ];
  if (manifest.capabilities.includes("source.read")) {
    const sourceRoot = process.env.HIVESWARM_SOURCE_ROOT;
    const repository = agentRun.target.startsWith("repository:") ? agentRun.target.slice("repository:".length) : "";
    if (!sourceRoot || !repository) throw new Error("Source agents require a repository: target and HIVESWARM_SOURCE_ROOT on the Docker host.");
    const root = resolve(sourceRoot);
    const source = resolve(root, repository);
    if (source !== root && !source.startsWith(`${root}${sep}`)) throw new Error("Repository target escapes HIVESWARM_SOURCE_ROOT.");
    mounts.push({ Type: "bind", Source: source, Target: "/target", ReadOnly: true });
  }
  const configuredEnvironment = manifest.configuration.flatMap(({ key, required }) => {
    const value = process.env[key];
    if (required && !value) throw new Error(`${manifest.name} requires worker configuration ${key}.`);
    return value ? [`${key}=${value}`] : [];
  });
  const isBurp = manifest.id === "burp-suite";
  const isHeavy = isBurp || manifest.capabilities.includes("browser.interactive") || manifest.id === "semgrep";
  if (isBurp) mounts.push({ Type: "volume", Source: process.env.BURP_VOLUME ?? "hiveswarm-burp", Target: "/opt/burp", ReadOnly: false });
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
      `HIVESWARM_API_URL=${apiUrl}`,
      `HIVESWARM_ARTIFACT_DIR=/artifacts/${agentRun.id}`,
      `HIVESWARM_ARTIFACT_BASE=/api/artifacts/${agentRun.id}`,
      ...(manifest.capabilities.includes("source.read") ? ["HIVESWARM_SOURCE_PATH=/target"] : []),
      ...configuredEnvironment,
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
      Memory: (isBurp ? 4_096 : isHeavy ? 1_536 : 512) * 1024 * 1024,
      NanoCpus: (isBurp ? 2 : 1) * 1_000_000_000,
      PidsLimit: 256,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=128m" },
      Mounts: mounts,
    },
  });

  const stream = await container.attach({ stream: true, stdout: true, stderr: true });
  const streamEnded = new Promise<void>((resolveStream) => {
    stream.once("end", resolveStream);
    stream.once("close", resolveStream);
    stream.once("error", resolveStream);
  });
  let callbackChain = Promise.resolve();
  const lineSink = (level: "info" | "error") => {
    let buffered = "";
    return new Writable({
      write(chunk: Buffer, _encoding, done) {
        buffered += chunk.toString("utf8");
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          const clean = line.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
          if (!clean) continue;
          let event: AgentEvent = { type: "log", level, message: clean.slice(0, 8_000) };
          try {
            const parsed = agentEventSchema.safeParse(JSON.parse(clean));
            if (parsed.success) event = parsed.data;
          } catch {}
          callbackChain = callbackChain.then(() => callback(agentRun.id, "events", event)).catch((error) => console.error(`Event callback failed for ${agentRun.id}: ${(error as Error).message}`));
        }
        done();
      },
      final(done) {
        const clean = buffered.trim();
        if (clean) callbackChain = callbackChain.then(() => callback(agentRun.id, "events", { type: "log", level, message: clean.slice(0, 8_000) } satisfies AgentEvent));
        void callbackChain.finally(done);
      },
    });
  };
  docker.modem.demuxStream(stream, lineSink("info"), lineSink("error"));
  await container.start();
  const result = await container.wait();
  await streamEnded;
  await callbackChain;
  await callback(agentRun.id, "complete", {
    outcome: result.StatusCode === 0 ? "completed" : "failed",
    message: result.StatusCode === 0 ? `${manifest.name} completed.` : `${manifest.name} exited with status ${result.StatusCode}.`,
  });
  await container.remove({ force: true });
}

type ControlJob = { runId: string; agentRunIds: string[]; action: "pause" | "resume" | "terminate" };

async function controlContainers(command: ControlJob) {
  for (const agentRunId of command.agentRunIds) {
    const containers = await docker.listContainers({ all: true, filters: { label: [`hiveswarm.agent-run=${agentRunId}`] } });
    for (const summary of containers) {
      const container = docker.getContainer(summary.Id);
      try {
        const detail = await container.inspect();
        if (command.action === "pause" && detail.State.Running && !detail.State.Paused) await container.pause();
        if (command.action === "resume" && detail.State.Paused) await container.unpause();
        if (command.action === "terminate") {
          if (detail.State.Running) await container.stop({ t: 5 });
        }
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status !== 304 && status !== 404) throw error;
      }
    }
  }
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

const controlWorker = new Worker<ControlJob>(
  "hiveswarm-agent-control",
  async (job) => controlContainers(job.data),
  { connection: controlConnection, concurrency: 2 },
);

worker.on("completed", (job) => console.info(`Completed ${job.id}`));
worker.on("failed", (job, error) => console.error(`Failed ${job?.id ?? "unknown"}: ${error.message}`));
controlWorker.on("failed", (job, error) => console.error(`Control command ${job?.id ?? "unknown"} failed: ${error.message}`));

async function shutdown() {
  await worker.close();
  await controlWorker.close();
  await connection.quit();
  await controlConnection.quit();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
console.info(`HiveSwarm worker ready (${mode} mode).`);
