import type { Dashboard, Finding, GraphNode } from "@hiveswarm/contracts";

const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

export type EvaluationReport = {
  generatedAt: string;
  engagement: Dashboard["engagement"];
  executiveSummary: string;
  risk: Record<Finding["severity"], number>;
  findings: Finding[];
  attackPaths: Array<{ labels: string[]; relationships: string[] }>;
  coverage: Array<{ agent: string; lifecycle: string; status: string; task: string }>;
  artifacts: Dashboard["artifacts"];
  limitations: string[];
};

function attackPaths(dashboard: Dashboard) {
  const byId = new Map(dashboard.graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Dashboard["graph"]["edges"]>();
  for (const edge of dashboard.graph.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  const roots = dashboard.graph.nodes.filter((node) => ["engagement", "host", "website", "repository"].includes(node.kind));
  const paths: Array<{ labels: string[]; relationships: string[] }> = [];
  const visit = (node: GraphNode, labels: string[], relationships: string[], seen: Set<string>) => {
    if (seen.has(node.id) || labels.length > 8 || paths.length >= 20) return;
    const nextSeen = new Set(seen).add(node.id);
    const nextLabels = [...labels, node.label];
    if (node.kind === "finding") {
      paths.push({ labels: nextLabels, relationships });
      return;
    }
    for (const edge of outgoing.get(node.id) ?? []) {
      const target = byId.get(edge.target);
      if (target) visit(target, nextLabels, [...relationships, edge.label ?? edge.relationship], nextSeen);
    }
  };
  for (const root of roots) visit(root, [], [], new Set());
  return paths;
}

export function generateReport(dashboard: Dashboard): EvaluationReport {
  const findings = [...dashboard.findings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const risk = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) risk[finding.severity] += 1;
  const substantive = risk.critical + risk.high + risk.medium + risk.low;
  const executiveSummary = findings.length
    ? `HiveSwarm mapped ${dashboard.metrics.assets} assets and recorded ${findings.length} findings. ${risk.critical + risk.high} require priority review; ${substantive} represent potential security weaknesses rather than informational observations.`
    : `HiveSwarm mapped ${dashboard.metrics.assets} assets. No findings have been recorded yet; this does not establish the absence of vulnerabilities.`;
  const limitations = [
    ...(dashboard.engagement.status === "running" || dashboard.engagement.status === "waiting_approval" ? ["The evaluation is still active; results may change as agents complete."] : []),
    ...(dashboard.approvals.some((approval) => approval.status === "pending") ? ["One or more scope or capability decisions remain pending and may limit coverage."] : []),
    ...(dashboard.agents.some((agent) => agent.status === "failed") ? ["At least one specialist failed; review activity logs before relying on coverage conclusions."] : []),
    "Automated evidence requires professional validation before remediation or disclosure decisions.",
  ];
  return {
    generatedAt: new Date().toISOString(),
    engagement: dashboard.engagement,
    executiveSummary,
    risk,
    findings,
    attackPaths: attackPaths(dashboard),
    coverage: dashboard.agents.map((agent) => ({ agent: agent.agentName, lifecycle: agent.lifecycle, status: agent.status, task: agent.task })),
    artifacts: dashboard.artifacts,
    limitations,
  };
}

function clean(value: string) { return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }

export function reportAsMarkdown(report: EvaluationReport) {
  const scope = report.engagement.scopeRules.map((rule) => `- **${rule.action.toUpperCase()}** ${rule.kind}: \`${rule.value}\``).join("\n");
  const findings = report.findings.length
    ? report.findings.map((finding, index) => [
        `### ${index + 1}. ${finding.title}`,
        `- Severity: **${finding.severity.toUpperCase()}**`,
        `- Status: ${finding.status}`,
        `- Confidence: ${Math.round(finding.confidence * 100)}%`,
        `- Asset: \`${finding.assetLabel}\``,
        "",
        finding.summary,
        "",
        "Evidence:",
        ...finding.evidence.map((item) => `- ${item}`),
        "",
        finding.remediation ? `Remediation: ${finding.remediation}` : "Remediation: Validate the issue and define a risk-appropriate corrective action.",
      ].join("\n")).join("\n\n")
    : "No findings have been recorded.";
  const paths = report.attackPaths.length
    ? report.attackPaths.map((path) => `- ${path.labels.map((label, index) => index ? `—[${path.relationships[index - 1]}]→ ${label}` : label).join(" ")}`).join("\n")
    : "- No evidence-backed vulnerability path is available yet.";
  const coverage = report.coverage.map((item) => `| ${clean(item.agent)} | ${item.lifecycle} | ${item.status} | ${clean(item.task)} |`).join("\n");
  return `# ${report.engagement.name} security evaluation

Generated ${report.generatedAt}

## Executive summary

${report.executiveSummary}

## Scope

Primary target: \`${report.engagement.target}\`

${scope}

## Risk summary

| Critical | High | Medium | Low | Informational |
| ---: | ---: | ---: | ---: | ---: |
| ${report.risk.critical} | ${report.risk.high} | ${report.risk.medium} | ${report.risk.low} | ${report.risk.info} |

## Findings

${findings}

## Vulnerability paths

${paths}

## Agent coverage

| Agent | Lifecycle | Status | Assignment |
| --- | --- | --- | --- |
${coverage}

## Limitations

${report.limitations.map((item) => `- ${item}`).join("\n")}
`;
}
