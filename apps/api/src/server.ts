import cors from "@fastify/cors";
import {
  approvalDecisionSchema,
  createEngagementSchema,
  spawnAgentRequestSchema,
} from "@hiveswarm/contracts";
import Fastify from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { QueueExecutionDriver, SimulatedExecutionDriver, type ExecutionDriver } from "./executor.js";
import { EventBus } from "./events.js";
import { id } from "./id.js";
import { OrchestratorService } from "./orchestrator.js";
import { DeterministicPlanner, OpenAiPlanner } from "./planner.js";
import { AgentRegistry } from "./registry.js";
import { MemoryStore, PostgresStore } from "./store.js";

loadDotEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = loadConfig();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024 });
const isAllowedOrigin = (origin?: string) => !origin || origin === config.webOrigin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
await app.register(cors, {
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  methods: ["GET", "POST", "OPTIONS"],
});

const store = config.storageDriver === "postgres"
  ? new PostgresStore(config.databaseUrl ?? (() => { throw new Error("DATABASE_URL is required for postgres storage."); })())
  : new MemoryStore();
await store.initialize();

const registry = new AgentRegistry(store, config.registryPath);
await registry.initialize();
const events = new EventBus();
const executor: ExecutionDriver = config.executionDriver === "queue"
  ? new QueueExecutionDriver(config.redisUrl)
  : new SimulatedExecutionDriver(store, events);
const orchestrator = new OrchestratorService(store, registry, executor, events);
const planner = config.openAiApiKey
  ? new OpenAiPlanner(config.openAiApiKey, config.openAiModel)
  : new DeterministicPlanner();

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.status(400).send({ error: "Invalid request", issues: error.issues });
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = /not found/i.test(message) ? 404 : /outside|approval|support|depth|declare/i.test(message) ? 422 : 500;
  app.log.error(error);
  return reply.status(status).send({ error: message });
});

app.get("/health", async () => ({ ok: true, storage: config.storageDriver, execution: config.executionDriver }));
app.get("/api/dashboard", async () => store.getDashboard());
app.get("/api/agents", async () => ({ agents: await registry.list() }));
app.post("/api/agents/install", async (request, reply) => {
  const manifest = await registry.install(request.body);
  await store.appendAudit({ id: id("audit"), actor: "human", action: "agent.installed", resource: `${manifest.id}@${manifest.version}`, detail: { image: manifest.image }, createdAt: new Date().toISOString() });
  return reply.status(201).send({ manifest });
});
app.post("/api/engagements", async (request, reply) => {
  const input = createEngagementSchema.parse(request.body);
  const dashboard = await store.getDashboard();
  dashboard.engagement = { id: id("eng"), name: input.name, target: input.target, status: "planning", startedAt: new Date().toISOString(), scopeRules: input.scopeRules };
  dashboard.agents = [];
  dashboard.findings = [];
  dashboard.approvals = [];
  dashboard.graph = { nodes: [], edges: [] };
  dashboard.logs = [];
  dashboard.metrics = { activeAgents: 0, assets: 0, findings: 0, pendingApprovals: 0 };
  await store.saveDashboard(dashboard);
  return reply.status(201).send({ engagement: dashboard.engagement });
});
app.post("/api/runs/:runId/plan", async () => planner.createPlan(await store.getDashboard(), await registry.list()));
app.post("/api/runs/:runId/state", async (request) => {
  const { runId } = request.params as { runId: string };
  const { status } = z.object({ status: z.enum(["running", "paused"]) }).parse(request.body);
  const dashboard = await store.getDashboard();
  dashboard.engagement.status = status;
  await store.saveDashboard(dashboard);
  await store.appendAudit({ id: id("audit"), actor: "human", action: `run.${status}`, resource: runId, detail: {}, createdAt: new Date().toISOString() });
  events.publish({ id: id("evt"), type: `run.${status}`, runId, occurredAt: new Date().toISOString(), data: {} });
  return { status };
});
app.post("/api/runs/:runId/agents", async (request, reply) => {
  const result = await orchestrator.spawn(spawnAgentRequestSchema.parse(request.body));
  return reply.status(201).send(result);
});
app.post("/api/approvals/:approvalId/decision", async (request) => {
  const { approvalId } = request.params as { approvalId: string };
  const input = approvalDecisionSchema.parse(request.body);
  return { approval: await orchestrator.decideApproval(approvalId, input.decision, input.note) };
});
app.post("/api/agent-runs/:agentRunId/events", async (request, reply) => {
  if (config.callbackToken && request.headers.authorization !== `Bearer ${config.callbackToken}`) return reply.status(401).send({ error: "Invalid agent callback token." });
  const { agentRunId } = request.params as { agentRunId: string };
  return reply.status(202).send({ accepted: await orchestrator.ingest(agentRunId, request.body) });
});
app.post("/api/agent-runs/:agentRunId/complete", async (request, reply) => {
  if (config.callbackToken && request.headers.authorization !== `Bearer ${config.callbackToken}`) return reply.status(401).send({ error: "Invalid agent callback token." });
  const { agentRunId } = request.params as { agentRunId: string };
  const body = request.body as { outcome?: "completed" | "failed"; message?: string };
  if (body.outcome !== "completed" && body.outcome !== "failed") return reply.status(400).send({ error: "Outcome must be completed or failed." });
  return { agentRun: await orchestrator.complete(agentRunId, body.outcome, body.message) };
});
app.get("/api/runs/:runId/events", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const origin = request.headers.origin;
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...(origin && isAllowedOrigin(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  reply.raw.write(`event: ready\ndata: ${JSON.stringify({ runId })}\n\n`);
  const unsubscribe = events.subscribe(runId, (event) => reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
  request.raw.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
});

app.addHook("onClose", async () => { await executor.close?.(); await store.close(); });
await app.listen({ host: config.host, port: config.port });
