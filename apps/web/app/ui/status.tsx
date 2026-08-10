import type { AgentRunStatus, Severity } from "@hiveswarm/contracts";

export function Status({ value }: { value: AgentRunStatus | "active" | "connected" | "paused" }) {
  const label = value.replaceAll("_", " ");
  return <span className={`status status--${value}`}><span className="status__dot" aria-hidden="true" />{label}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`severity severity--${severity}`}><span aria-hidden="true" className="severity__mark" />{severity}</span>;
}
