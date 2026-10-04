import type { AgentRun } from "@hiveswarm/contracts";
import type { CSSProperties } from "react";
import { Bot, FileCode, GitBranch, Globe, Radar, ScanSearch } from "lucide-react";
import { Status } from "./status";

export type TreeGuide = "line" | "empty" | "tee" | "elbow";

const icons: Record<string, typeof Bot> = {
  orchestrator: GitBranch,
  explorer: ScanSearch,
  "browser-user": Globe,
  "source-review": FileCode,
  "port-scanner": Radar,
};

function formatDuration(startedAt: string | null, completedAt: string | null, now: number) {
  if (!startedAt) return "queued";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : now;
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function AgentRow({
  agent,
  guides,
  selected,
  compact,
  now,
  onSelect,
}: {
  agent: AgentRun;
  guides: TreeGuide[];
  selected: boolean;
  compact?: boolean;
  now: number;
  onSelect: () => void;
}) {
  const Icon = icons[agent.agentId] ?? Bot;
  const running = agent.status === "running";
  return (
    <button
      className={`agent-row${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={compact ? `${agent.agentName}, ${agent.status.replaceAll("_", " ")}` : undefined}
      title={compact ? `${agent.agentName} · ${agent.status.replaceAll("_", " ")}` : undefined}
      style={{ "--depth": compact ? 0 : guides.length } as CSSProperties}
    >
      {compact ? null : (
        <span className="agent-row__tree" aria-hidden="true">
          {guides.map((guide, index) => guide === "empty" ? null : <span key={index} className={`tree-seg tree-seg--${guide}`} style={{ "--i": index } as CSSProperties} />)}
        </span>
      )}
      <span className={`agent-row__icon status--${agent.status}`}>
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        {running ? <span className="agent-row__ping" aria-hidden="true" /> : null}
      </span>
      {compact ? null : (
        <>
          <span className="agent-row__copy">
            <strong>{agent.agentName}</strong>
            <Status value={agent.status} />
          </span>
          <span className="agent-row__telemetry">
            <span className="agent-row__elapsed">{formatDuration(agent.startedAt, agent.completedAt, now)}</span>
            <span>{agent.logCount} evt</span>
          </span>
        </>
      )}
    </button>
  );
}
