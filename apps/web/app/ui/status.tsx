import type { AgentRunStatus, RunStatus, Severity } from "@hiveswarm/contracts";
import { Badge } from "@/components/ui/badge";

export function Status({
  value,
}: {
  value: AgentRunStatus | RunStatus | "active" | "connected";
}) {
  const label =
    value === "waiting_approval"
      ? "Waiting for approval"
      : value.charAt(0).toUpperCase() + value.slice(1);
  const palette = ["active", "connected", "completed"].includes(value)
    ? "bg-[var(--success-soft)] text-[var(--success-text,var(--success))]"
    : ["waiting_approval", "paused"].includes(value)
      ? "bg-[var(--warning-soft)] text-[var(--warning-text)]"
      : value === "failed"
        ? "bg-[var(--danger-soft)] text-[var(--danger-text)]"
        : ["running", "starting", "planning"].includes(value)
          ? "bg-[var(--info-soft)] text-[var(--info-text)]"
          : "bg-muted text-muted-foreground";
  return (
    <Badge
      variant="secondary"
      className={`gap-1.5 border-transparent ${palette}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full bg-current"
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

const severities = {
  critical: {
    label: "Critical",
    marks: 5,
    palette: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  },
  high: {
    label: "High",
    marks: 4,
    palette: "bg-[var(--danger-soft)] text-[var(--danger-text)]",
  },
  medium: {
    label: "Medium",
    marks: 3,
    palette: "bg-[var(--warning-soft)] text-[var(--warning-text)]",
  },
  low: {
    label: "Low",
    marks: 2,
    palette: "bg-[var(--info-soft)] text-[var(--info-text)]",
  },
  info: { label: "Info", marks: 1, palette: "bg-muted text-muted-foreground" },
} satisfies Record<Severity, { label: string; marks: number; palette: string }>;

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, marks, palette } = severities[severity];
  return (
    <Badge
      variant="secondary"
      className={`gap-2 border-transparent ${palette}`}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span
            key={index}
            className={`h-2.5 w-0.5 rounded-sm bg-current ${index < marks ? "" : "opacity-20"}`}
          />
        ))}
      </span>
      {label}
    </Badge>
  );
}
