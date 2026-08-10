import type { AgentRun } from "@hiveswarm/contracts";
import { Bot, ChevronRight, CirclePause, GitBranch, ScanSearch } from "lucide-react";
import { Status } from "./status";

const icons: Record<string, typeof Bot> = {
  orchestrator: GitBranch,
  explorer: ScanSearch,
  "browser-user": Bot,
  "source-review": Bot,
  "port-scanner": Bot,
};

export function AgentRow({ agent, selected, onSelect }: { agent: AgentRun; selected: boolean; onSelect: () => void }) {
  const Icon = agent.status === "waiting_approval" ? CirclePause : icons[agent.agentId] ?? Bot;
  return (
    <button className={`agent-row${selected ? " is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="agent-row__rail" style={{ "--depth": agent.depth } as React.CSSProperties} aria-hidden="true" />
      <span className="agent-row__icon"><Icon size={17} strokeWidth={1.5} aria-hidden="true" /></span>
      <span className="agent-row__copy">
        <strong>{agent.agentName}</strong>
        <Status value={agent.status} />
      </span>
      <ChevronRight className="icon-directional" size={15} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
