import type { AgentCapability, AgentManifest, Dashboard, SpawnAgentRequest } from "@hiveswarm/contracts";

const APPROVAL_CAPABILITIES = new Set<AgentCapability>([
  "network.high-rate",
  "credentials.use",
  "exploit.execute",
]);

export type PolicyDecision =
  | { allowed: true; depth: number }
  | { allowed: false; reason: string; approvalType?: "scope_expansion" | "high_risk_capability" | "credential_use" | "high_rate_scan" };

function targetHost(value: string): string {
  if (value.startsWith("repository:")) return value;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase(); }
  catch { return value.toLowerCase(); }
}

function ruleMatches(kind: string, ruleValue: string, target: string): boolean {
  if (kind === "repository") return target === ruleValue || target.startsWith(`${ruleValue}/`);
  if (kind === "url-prefix") return target.startsWith(ruleValue);
  const host = targetHost(target);
  const rule = ruleValue.toLowerCase();
  if (rule.startsWith("*.")) return host === rule.slice(2) || host.endsWith(rule.slice(1));
  return host === rule;
}

export class PolicyEngine {
  evaluate(dashboard: Dashboard, manifest: AgentManifest, request: SpawnAgentRequest): PolicyDecision {
    const parent = request.parentAgentRunId
      ? dashboard.agents.find((agent) => agent.id === request.parentAgentRunId)
      : undefined;
    if (request.parentAgentRunId && !parent) return { allowed: false, reason: "The parent agent execution does not exist." };
    const depth = parent ? parent.depth + 1 : 1;
    if (depth > 5) return { allowed: false, reason: "Recursive agent depth cannot exceed five." };
    if (!manifest.lifecycle.includes(request.lifecycle)) return { allowed: false, reason: `${manifest.name} does not support ${request.lifecycle} lifecycle.` };

    const undeclared = request.requestedCapabilities.find((capability) => !manifest.capabilities.includes(capability));
    if (undeclared) return { allowed: false, reason: `${manifest.name} does not declare capability ${undeclared}.` };

    const denied = dashboard.engagement.scopeRules.some(
      (rule) => rule.action === "deny" && ruleMatches(rule.kind, rule.value, request.target),
    );
    const allowed = dashboard.engagement.scopeRules.some(
      (rule) => rule.action === "allow" && ruleMatches(rule.kind, rule.value, request.target),
    );
    if (denied || !allowed) return { allowed: false, reason: `${request.target} is outside the active allowlist.`, approvalType: "scope_expansion" };

    const gated = request.requestedCapabilities.find((capability) => APPROVAL_CAPABILITIES.has(capability));
    if (gated === "credentials.use") return { allowed: false, reason: "Credential use requires human approval.", approvalType: "credential_use" };
    if (gated === "network.high-rate") return { allowed: false, reason: "High-rate scanning requires human approval.", approvalType: "high_rate_scan" };
    if (gated) return { allowed: false, reason: `${gated} requires human approval.`, approvalType: "high_risk_capability" };
    return { allowed: true, depth };
  }
}
