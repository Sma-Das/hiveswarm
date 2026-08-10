import { z } from "zod";

export const agentLifecycleSchema = z.enum(["task", "session"]);
export type AgentLifecycle = z.infer<typeof agentLifecycleSchema>;

export const agentCapabilitySchema = z.enum([
  "network.passive",
  "network.active",
  "network.high-rate",
  "browser.interactive",
  "proxy.intercept",
  "source.read",
  "source.scan",
  "secrets.scan",
  "credentials.use",
  "exploit.execute",
  "scope.propose",
  "graph.write",
  "finding.write",
]);
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;

export const agentManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  name: z.string().min(2).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  description: z.string().min(12).max(320),
  role: z.string().min(2).max(80),
  image: z.string().min(3),
  command: z.array(z.string()).min(1),
  lifecycle: z.array(agentLifecycleSchema).min(1),
  capabilities: z.array(agentCapabilitySchema),
  skills: z.array(z.string().min(2)).default([]),
  accepts: z.array(z.string().min(2)).default([]),
  emits: z.array(z.string().min(2)).default([]),
  configuration: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
        required: z.boolean(),
        secret: z.boolean().default(false),
        description: z.string().min(3),
      }),
    )
    .default([]),
  enabled: z.boolean().default(true),
  labels: z.record(z.string(), z.string()).default({}),
});
export type AgentManifest = z.infer<typeof agentManifestSchema>;

export const scopeRuleSchema = z.object({
  id: z.string(),
  kind: z.enum(["host", "domain", "cidr", "url-prefix", "repository"]),
  value: z.string().min(1),
  action: z.enum(["allow", "deny"]),
});
export type ScopeRule = z.infer<typeof scopeRuleSchema>;

export const runStatusSchema = z.enum([
  "planning",
  "running",
  "waiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "terminated",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof severitySchema>;

export const graphNodeKindSchema = z.enum([
  "engagement",
  "host",
  "service",
  "website",
  "subdomain",
  "directory",
  "endpoint",
  "repository",
  "identity",
  "finding",
  "agent",
]);
export type GraphNodeKind = z.infer<typeof graphNodeKindSchema>;

export const graphNodeSchema = z.object({
  id: z.string(),
  kind: graphNodeKindSchema,
  label: z.string(),
  subtitle: z.string().optional(),
  severity: severitySchema.optional(),
  status: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  discoveredBy: z.string().optional(),
  createdAt: z.string(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relationship: z.string(),
  label: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const findingSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: severitySchema,
  status: z.enum(["open", "confirmed", "accepted", "remediated", "dismissed"]),
  confidence: z.number().min(0).max(1),
  assetLabel: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  remediation: z.string().optional(),
  discoveredBy: z.string(),
  createdAt: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

export const approvalSchema = z.object({
  id: z.string(),
  runId: z.string(),
  agentRunId: z.string().optional(),
  type: z.enum(["scope_expansion", "high_risk_capability", "credential_use", "high_rate_scan"]),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  title: z.string(),
  rationale: z.string(),
  requestedAction: z.string(),
  requestedBy: z.string(),
  createdAt: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const agentRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  parentAgentRunId: z.string().nullable(),
  agentId: z.string(),
  agentName: z.string(),
  lifecycle: agentLifecycleSchema,
  status: agentRunStatusSchema,
  depth: z.number().int().min(0).max(5),
  task: z.string(),
  target: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  logCount: z.number().int().nonnegative(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;

export const logEntrySchema = z.object({
  id: z.string(),
  agentRunId: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  timestamp: z.string(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const dashboardSchema = z.object({
  engagement: z.object({
    id: z.string(),
    name: z.string(),
    target: z.string(),
    status: runStatusSchema,
    startedAt: z.string(),
    scopeRules: z.array(scopeRuleSchema),
  }),
  metrics: z.object({
    activeAgents: z.number(),
    assets: z.number(),
    findings: z.number(),
    pendingApprovals: z.number(),
  }),
  agents: z.array(agentRunSchema),
  findings: z.array(findingSchema),
  approvals: z.array(approvalSchema),
  graph: z.object({ nodes: z.array(graphNodeSchema), edges: z.array(graphEdgeSchema) }),
  logs: z.array(logEntrySchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const spawnAgentRequestSchema = z.object({
  agentId: z.string(),
  lifecycle: agentLifecycleSchema,
  task: z.string().min(8).max(4000),
  target: z.string().min(1).max(2048),
  parentAgentRunId: z.string().optional(),
  requestedCapabilities: z.array(agentCapabilitySchema).default([]),
});
export type SpawnAgentRequest = z.infer<typeof spawnAgentRequestSchema>;

export const createEngagementSchema = z.object({
  name: z.string().min(2).max(120),
  target: z.string().min(3).max(2048),
  scopeRules: z.array(scopeRuleSchema).min(1),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(["approved", "denied"]),
  note: z.string().max(1000).optional(),
});

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), level: z.enum(["debug", "info", "warn", "error"]), message: z.string() }),
  z.object({ type: z.literal("node"), node: graphNodeSchema.omit({ id: true, createdAt: true }) }),
  z.object({ type: z.literal("edge"), edge: graphEdgeSchema.omit({ id: true }) }),
  z.object({ type: z.literal("finding"), finding: findingSchema.omit({ id: true, createdAt: true }) }),
  z.object({ type: z.literal("scope_proposal"), value: z.string(), kind: scopeRuleSchema.shape.kind, rationale: z.string() }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
