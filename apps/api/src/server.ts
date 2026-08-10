import cors from "@fastify/cors";
import {
  approvalDecisionSchema,
  createEngagementSchema,
  orchestrateRequestSchema,
  spawnAgentRequestSchema,
  type Dashboard,
} from "@hiveswarm/contracts";
import Fastify from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { config as loadDotEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { QueueExecutionDriver, SimulatedExecutionDriver, type ExecutionDriver } from "./executor.js";
import { EventBus } from "./events.js";
import { id } from "./id.js";
import { OrchestratorService } from "./orchestrator.js";
import { OrchestrationLoop } from "./orchestration-loop.js";
import { OpenAiResponsesProvider } from "./model-provider.js";
import { DeterministicPlanner, OpenAiPlanner } from "./planner.js";
import { AgentRegistry } from "./registry.js";
import { generateReport, reportAsMarkdown } from "./report.js";
import { MemoryStore, PostgresStore } from "./store.js";

loadDotEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const config = loadConfig();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 2 * 1024 * 1024 });
const isAllowedOrigin = (origin?: string) => !origin || origin === config.webOrigin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
await app.register(cors, {
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
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
const fallbackPlanner = new DeterministicPlanner();
const modelProvider = config.openAiApiKey ? new OpenAiResponsesProvider(config.openAiApiKey, config.openAiModel) : undefined;
const planner = modelProvider
  ? new OpenAiPlanner(modelProvider)
  : fallbackPlanner;
const orchestrationLoop = new OrchestrationLoop(
  store,
  registry,
  orchestrator,
  fallbackPlanner,
  modelProvider,
);

async function assertCurrentRun(runId: string) {
  await store.getDashboardForRun(runId);
}

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof ZodError) return reply.status(400).send({ error: "Invalid request", issues: error.issues });
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = /not found/i.test(message) ? 404 : /outside|approval|support|depth|declare|require|capability|lifecycle|allowlist/i.test(message) ? 422 : 500;
  app.log.error(error);
  return reply.status(status).send({ error: message });
});

app.get("/health", async () => ({ ok: true, storage: config.storageDriver, execution: config.executionDriver }));
app.get("/api/projects", async () => ({ activeProjectId: await store.getActiveProjectId(), projects: await store.listProjects() }));
app.post("/api/projects/:projectId/activate", async (request) => {
  const { projectId } = request.params as { projectId: string };
  await store.setActiveProject(projectId);
  await store.appendAudit({ id: id("audit"), actor: "human", action: "project.activated", resource: projectId, detail: {}, createdAt: new Date().toISOString() });
  return { activeProjectId: projectId };
});
app.get("/api/dashboard", async (request) => {
  const { projectId } = z.object({ projectId: z.string().optional() }).parse(request.query ?? {});
  return store.getDashboard(projectId);
});
app.get("/api/reports/current", async (request, reply) => {
  const { format, download, projectId } = z.object({ format: z.enum(["json", "markdown"]).default("json"), download: z.enum(["0", "1"]).default("0"), projectId: z.string().optional() }).parse(request.query ?? {});
  const report = generateReport(await store.getDashboard(projectId));
  if (format === "markdown") {
    if (download === "1") reply.header("Content-Disposition", `attachment; filename="hiveswarm-${report.engagement.id}.md"`);
    return reply.type("text/markdown; charset=utf-8").send(reportAsMarkdown(report));
  }
  return report;
});
app.get("/api/agents", async () => ({ agents: await registry.list() }));
app.get("/api/agents/:agentId", async (request, reply) => {
  const { agentId } = request.params as { agentId: string };
  const manifest = await registry.get(agentId);
  return manifest ? { manifest } : reply.status(404).send({ error: "Agent not found." });
});
app.get("/api/artifacts/:agentRunId/:filename", async (request, reply) => {
  const { agentRunId, filename } = request.params as { agentRunId: string; filename: string };
  if (!/^[a-zA-Z0-9_-]+$/.test(agentRunId) || !/^[a-zA-Z0-9._-]+$/.test(filename)) return reply.status(400).send({ error: "Invalid artifact path." });
  const contentTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8" };
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  try {
    const artifact = await readFile(join(config.artifactPath, agentRunId, filename));
    return reply.type(contentTypes[extension] ?? "application/octet-stream").send(artifact);
  } catch {
    return reply.status(404).send({ error: "Artifact not found." });
  }
});
app.post("/api/agents/install", async (request, reply) => {
  const manifest = await registry.install(request.body);
  await store.appendAudit({ id: id("audit"), actor: "human", action: "agent.installed", resource: `${manifest.id}@${manifest.version}`, detail: { image: manifest.image }, createdAt: new Date().toISOString() });
  return reply.status(201).send({ manifest });
});
app.post("/api/scope/rules", async (request, reply) => {
  const input = z.object({ projectId: z.string(), kind: z.enum(["host", "domain", "cidr", "url-prefix", "repository"]), value: z.string().min(1).max(2048), action: z.enum(["allow", "deny"]) }).parse(request.body);
  const rule = await store.mutateDashboard({ kind: "project", id: input.projectId }, (dashboard) => {
    if (dashboard.engagement.scopeRules.some((current) => current.kind === input.kind && current.value === input.value && current.action === input.action)) throw new Error("An identical scope rule already exists.");
    const current = { id: id("scope"), kind: input.kind, value: input.value, action: input.action };
    dashboard.engagement.scopeRules.push(current);
    return current;
  });
  await store.appendAudit({ id: id("audit"), actor: "human", action: "scope.rule.added", resource: rule.id, detail: rule, createdAt: new Date().toISOString() });
  return reply.status(201).send({ rule });
});
app.delete("/api/scope/rules/:ruleId", async (request, reply) => {
  const { ruleId } = request.params as { ruleId: string };
  const { projectId } = z.object({ projectId: z.string() }).parse(request.query ?? {});
  const rule = await store.mutateDashboard({ kind: "project", id: projectId }, (dashboard) => {
    const current = dashboard.engagement.scopeRules.find((item) => item.id === ruleId);
    if (!current) throw new Error("Scope rule not found.");
    if (current.action === "allow" && dashboard.engagement.scopeRules.filter((item) => item.action === "allow").length === 1) throw new Error("Keep at least one allow rule before removing this boundary.");
    dashboard.engagement.scopeRules = dashboard.engagement.scopeRules.filter((item) => item.id !== ruleId);
    return current;
  });
  await store.appendAudit({ id: id("audit"), actor: "human", action: "scope.rule.removed", resource: ruleId, detail: rule, createdAt: new Date().toISOString() });
  return reply.status(204).send();
});
app.post("/api/engagements", async (request, reply) => {
  const input = createEngagementSchema.parse(request.body);
  const engagementId = id("eng");
  const startedAt = new Date().toISOString();
  const orchestratorRunId = id("ar");
  const engagementNodeId = id("node");
  const orchestratorNodeId = id("node");
  const dashboard: Dashboard = {
    engagement: { id: engagementId, name: input.name, target: input.target, status: "planning", startedAt, scopeRules: input.scopeRules },
    agents: [{
    id: orchestratorRunId,
    runId: engagementId,
    parentAgentRunId: null,
    agentId: "orchestrator",
    agentName: "Orchestrator",
    lifecycle: "session",
    status: "running",
    depth: 0,
    task: "Coordinate the authorized evaluation and synthesize specialist evidence.",
    target: input.target,
    requestedCapabilities: [],
    executionPlan: [],
    startedAt,
    completedAt: null,
    logCount: 1,
    }],
    findings: [],
    approvals: [],
    graph: { nodes: [
      { id: engagementNodeId, kind: "engagement", label: input.name, subtitle: input.target, status: "planning", metadata: {}, discoveredBy: "Orchestrator", createdAt: startedAt },
      { id: orchestratorNodeId, kind: "agent", label: "Orchestrator", subtitle: "Control plane", status: "running", metadata: { agentRunId: orchestratorRunId }, discoveredBy: "HiveSwarm", createdAt: startedAt },
    ], edges: [{ id: id("edge"), source: engagementNodeId, target: orchestratorNodeId, relationship: "orchestrated_by", metadata: {} }] },
    logs: [{ id: id("log"), agentRunId: orchestratorRunId, level: "info", message: "Engagement initialized. Waiting for an evaluation objective.", timestamp: startedAt }],
    artifacts: [],
    metrics: { activeAgents: 1, assets: 1, findings: 0, pendingApprovals: 0 },
  };
  await store.saveDashboard(dashboard);
  await store.setActiveProject(engagementId);
  await store.appendAudit({ id: id("audit"), actor: "human", action: "project.created", resource: engagementId, detail: { name: input.name, target: input.target }, createdAt: startedAt });
  return reply.status(201).send({ engagement: dashboard.engagement });
});
app.post("/api/runs/:runId/plan", async (request) => {
  const { runId } = request.params as { runId: string };
  await assertCurrentRun(runId);
  return planner.createPlan(await store.getDashboardForRun(runId), await registry.list());
});
app.post("/api/runs/:runId/orchestrate", async (request) => {
  const { runId } = request.params as { runId: string };
  await assertCurrentRun(runId);
  return orchestrationLoop.run(orchestrateRequestSchema.parse(request.body ?? {}), runId);
});
app.post("/api/runs/:runId/state", async (request) => {
  const { runId } = request.params as { runId: string };
  const { status } = z.object({ status: z.enum(["running", "paused"]) }).parse(request.body);
  return orchestrator.setRunState(runId, status);
});
app.post("/api/runs/:runId/agents", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  await assertCurrentRun(runId);
  const result = await orchestrator.spawn(spawnAgentRequestSchema.parse(request.body), runId);
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
app.post("/api/agent-runs/:agentRunId/terminate", async (request) => {
  const { agentRunId } = request.params as { agentRunId: string };
  return { agentRun: await orchestrator.terminate(agentRunId) };
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
